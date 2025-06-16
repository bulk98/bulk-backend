// routes/posts.routes.js

console.log("BACKEND: Cargando el archivo routes/posts.routes.js"); // Verifica que este archivo se cargue

const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');
const { param, body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // File System
const { UserType } = require('@prisma/client');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary'); // Ajusta si tu carpeta utils está en otro lugar
const { ReactionType } = require('../constants/reactions'); // ✅ Sin ciclos
const { RoleInCommunity } = require('@prisma/client');



// Configuración de Multer para almacenamiento temporal en disco
// Se crea una carpeta 'uploads_temp_bulk' en la raíz del proyecto si no existe
const tempUploadDir = path.join(__dirname, '..', 'uploads_temp_bulk');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempUploadDir);
  },
  filename: function (req, file, cb) {
    const safeOriginalName = file.originalname.replace(/\s+/g, '_');
    cb(null, Date.now() + '-' + safeOriginalName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'image/gif' || file.mimetype === 'image/webp') {
    cb(null, true);
  } else {
    // Pasar el error a través de req para que el manejador de la ruta lo capture
    req.fileValidationError = 'Tipo de archivo no soportado. Solo imágenes (JPEG, PNG, GIF, WEBP) son permitidas.';
    cb(null, false); // Rechazar el archivo, Multer no lo procesará
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 10 }, // Límite de 10MB (ajustable)
  fileFilter: fileFilter
});


// --- Endpoint para Crear una Publicación (VERSIÓN FINAL Y CORRECTA) ---
router.post(
  '/comunidades/:communityId/posts',
  authenticateToken,
  upload.single('postImage'),
  [
    param('communityId').isMongoId().withMessage('El ID de la comunidad no es válido.'),
    body('title').trim().notEmpty().withMessage('El título es obligatorio.'),
    body('content').trim().notEmpty().withMessage('El contenido es obligatorio.'),
  ],
  async (req, res) => {
    if (req.fileValidationError) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ errors: [{ msg: req.fileValidationError }] });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ errors: errors.array() });
    }

    const { communityId } = req.params;
    const authorId = req.userId;
    const { title, content, esPremium } = req.body; // esPremium llegará como string "true" o undefined

    let tempFilePath = req.file ? req.file.path : null;
    let cloudinaryResponse = null;

    try {
        const [comunidad, autorDetails, userMembership] = await Promise.all([
            prisma.community.findUnique({ where: { id: communityId }, select: { createdById: true } }),
            prisma.user.findUnique({ where: { id: authorId }, select: { tipo_usuario: true } }),
            prisma.communityMembership.findUnique({ where: { userId_communityId: { userId: authorId, communityId: communityId } }, select: { role: true, canPublishPremiumContent: true } })
        ]);

        if (!comunidad) {
            if (tempFilePath) fs.unlinkSync(tempFilePath);
            return res.status(404).json({ error: 'Comunidad no encontrada.' });
        }

        const isCreator = comunidad.createdById === authorId;
        const isModerator = userMembership?.role === RoleInCommunity.MODERATOR;

        if (!isCreator && !isModerator) {
            if (tempFilePath) fs.unlinkSync(tempFilePath);
            return res.status(403).json({ error: 'No tienes permiso para crear publicaciones en esta comunidad.' });
        }

        // Lógica de permisos correcta y limpia
        const canMarkAsPremium = (autorDetails?.tipo_usuario === UserType.OG) || (isModerator && userMembership?.canPublishPremiumContent === true);
        const intendsToPostPremium = esPremium === 'true';
        const finalIsPremium = canMarkAsPremium && intendsToPostPremium;

        if (intendsToPostPremium && !canMarkAsPremium) {
            if (tempFilePath) fs.unlinkSync(tempFilePath);
            return res.status(403).json({ error: 'No tienes permiso para marcar este post como premium.' });
        }
        
        if (tempFilePath) {
            try {
                cloudinaryResponse = await uploadToCloudinary(tempFilePath, "bulk_posts");
            } catch (uploadError) {
                return res.status(500).json({ error: 'Error al subir la imagen del post.', detalle: uploadError.message });
            } finally {
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            }
        }

        const dataToCreate = {
            title: title.trim(), 
            content: content.trim(),
            author: { connect: { id: authorId } },
            community: { connect: { id: communityId } },
            esPremium: finalIsPremium // Se usa el valor booleano final y correcto
        };

        if (cloudinaryResponse) {
            dataToCreate.imageUrl = cloudinaryResponse.url;
            dataToCreate.imagePublicId = cloudinaryResponse.public_id;
        }

        const nuevoPost = await prisma.post.create({
            data: dataToCreate,
            select: { id: true, title: true, esPremium: true }
        });
        
        res.status(201).json(nuevoPost);

    } catch (error) {
        console.error(`Error en POST /comunidades/${communityId}/posts:`, error);
        if (cloudinaryResponse) {
            await deleteFromCloudinary(cloudinaryResponse.public_id).catch(e => console.error("Fallo en rollback de Cloudinary", e));
        }
        res.status(500).json({ error: 'Error interno al crear la publicación.', detalle: error.message });
    }
  }
);

// --- NUEVO ENDPOINT: Ver los Detalles de una Publicación Específica ---
router.get(
  '/posts/:postId',
  authenticateToken,
  [
    param('postId').isMongoId().withMessage('El ID de la publicación no tiene un formato válido.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const postId = req.params.postId;
    const userId = req.userId;

    try {
      const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
          id: true,
          title: true,
          content: true,
          esPremium: true,
          createdAt: true,
          updatedAt: true,
          communityId: true,
          authorId: true,
          imageUrl: true,
          author: {
              select: {
                  id: true,
                  name: true,
                  username: true,
                  avatarUrl: true
              }
          },
          community: {
              select: {
                  id: true,
                  name: true,
                  logoUrl: true,
                  createdById: true
              }
          },
        }
      });

      if (!post) {
        return res.status(404).json({ error: 'Publicación no encontrada.' });
      }
      
      // Lógica para verificar si el post es premium y si el usuario tiene acceso
      if (post.esPremium && post.authorId !== userId) {
          const userRequesting = await prisma.user.findUnique({
            where: { id: userId },
            select: { suscritoAComunidadesIds: true }
          });
          const isSubscribed = userRequesting?.suscritoAComunidadesIds?.includes(post.communityId) ?? false;
          if (!isSubscribed) {
            return res.status(403).json({ error: 'Acceso denegado. Se requiere suscripción para ver este post.' });
          }
      }

      // Lógica para saber si el usuario actual le ha dado "like"
      const reaction = await prisma.reaction.findFirst({ 
        where: { userId: userId, postId: postId, type: 'LIKE' },
        select: { id: true }
      });

      // Lógica para contar likes y comentarios
      const [likesCount, commentsCount] = await Promise.all([
          prisma.reaction.count({ where: { postId: postId, type: 'LIKE' } }),
          prisma.comment.count({ where: { postId: postId } })
      ]);

      res.status(200).json({
        ...post,
        likesCount,
        commentsCount,
        userHasLiked: !!reaction
      });

    } catch (error) {
      console.error(`Error en GET /posts/${postId}:`, error);
      res.status(500).json({ error: 'Error al obtener los detalles de la publicación.', detalle: error.message });
    }
  }
);

// --- Endpoint para Actualizar una Publicación (Post) ---
router.put(
    '/posts/:postId',
    authenticateToken,
    [
      param('postId').isMongoId().withMessage("El ID del post no es válido."),
      body('title').optional().trim().notEmpty().withMessage('El título no puede ser vacío si se provee.'),
      body('content').optional().trim().notEmpty().withMessage('El contenido no puede ser vacío si se provee.'),
      // No permitimos cambiar 'esPremium' ni 'communityId' ni 'imageUrl' aquí por ahora.
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const postId = req.params.postId;
        const userId = req.userId;
        const { title, content } = req.body;
  
        if (title === undefined && content === undefined) {
             return res.status(400).json({ error: 'Se deben proporcionar datos para actualizar (title o content).' });
        }
        console.log(`>>> (posts.routes.js) Usuario ID ${userId} actualizando Post ID ${postId}`);
        try {
            const postExistente = await prisma.post.findUnique({
                where: { id: postId },
                select: { authorId: true } // Solo el autor puede editar
            });
  
            if (!postExistente) {
                return res.status(404).json({ error: 'Publicación no encontrada.' });
            }
  
            if (postExistente.authorId !== userId) {
                return res.status(403).json({ error: 'No tienes permiso para actualizar esta publicación.' });
            }
  
            const dataToUpdate = {};
            if (title !== undefined) { dataToUpdate.title = title; }
            if (content !== undefined) { dataToUpdate.content = content; }
  
            const postActualizado = await prisma.post.update({
                where: { id: postId },
                data: dataToUpdate,
                select: { 
                     id: true, title: true, content: true, esPremium: true, createdAt: true, updatedAt: true,
                     imageUrl: true, imagePublicId: true, // Devolver info de imagen
                     author: { select: { id: true, email: true } },
                     community: { select: { id: true, name: true } },
                }
            });
            res.status(200).json({
                mensaje: 'Publicación actualizada con éxito',
                post: postActualizado
            });
        } catch (error) {
            console.error(`❌ (posts.routes.js) Error en PUT /posts/${postId}:`, error);
            if (error.code === 'P2025') {
                  res.status(404).json({ error: 'Publicación no encontrada para actualizar.', detalle: error.message });
            } else {
                res.status(500).json({ error: 'Error al actualizar la publicación.', detalle: error.message });
            }
        }
    }
  );  

// --- Endpoint para Eliminar una Publicación (Post) ---
router.delete(
    '/posts/:postId',
    authenticateToken,
    [
      param('postId').isMongoId().withMessage("El ID del post no es válido.")
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const postId = req.params.postId;
        const userId = req.userId;
  
        console.log(`>>> (posts.routes.js) Usuario ID ${userId} intentando eliminar Post ID ${postId}`);
        try {
            const postToDelete = await prisma.post.findUnique({
                where: { id: postId },
                select: {
                    authorId: true,
                    communityId: true, 
                    imagePublicId: true // Para eliminar de Cloudinary
                }
            });
  
            if (!postToDelete) {
                return res.status(404).json({ error: 'Publicación no encontrada.' });
            }
  
            // Lógica de permisos: Autor, Creador de comunidad, o Moderador de comunidad
            let puedeBorrar = false;
            if (postToDelete.authorId === userId) {
                puedeBorrar = true;
            } else {
                const membership = await prisma.communityMembership.findUnique({
                    where: {
                        userId_communityId: {
                            userId: userId,
                            communityId: postToDelete.communityId
                        }
                    },
                    select: { role: true }
                });
                if (membership && (membership.role === 'CREATOR' || membership.role === 'MODERATOR')) {
                    puedeBorrar = true;
                }
            }

            if (!puedeBorrar) {
                return res.status(403).json({ error: 'No tienes permiso para eliminar esta publicación.' });
            }

            // Eliminar imagen de Cloudinary si existe
            if (postToDelete.imagePublicId) {
                try {
                    console.log(`>>> Intentando eliminar imagen de Cloudinary: ${postToDelete.imagePublicId}`);
                    await deleteFromCloudinary(postToDelete.imagePublicId);
                    console.log(`✅ Imagen ${postToDelete.imagePublicId} eliminada de Cloudinary.`);
                } catch (cloudinaryError) {
                    console.error(`⚠️ Error eliminando imagen ${postToDelete.imagePublicId} de Cloudinary:`, cloudinaryError.message);
                    // Continuamos con la eliminación del post de la DB de todas formas
                }
            }
            
            // Eliminar comentarios asociados al post
            await prisma.comment.deleteMany({
                where: { postId: postId }
            });
            console.log(`>>> (posts.routes.js) Comentarios asociados al Post ID ${postId} eliminados.`);
  
            // Eliminar el post de la base de datos
            await prisma.post.delete({
                where: { id: postId }
            });
  
            console.log(`✅ (posts.routes.js) Post ID ${postId} y su imagen (si existía) eliminados.`);
            res.status(200).json({ mensaje: 'Publicación y recursos asociados eliminados con éxito.' });

        } catch (error) {
            console.error(`❌ (posts.routes.js) Error en DELETE /posts/${postId}:`, error);
            if (error.code === 'P2025') {
                res.status(404).json({ error: 'Publicación no encontrada para eliminar.', detalle: error.message });
            } else {
                res.status(500).json({ error: 'Error al eliminar la publicación.', detalle: error.message });
            }
        }
    }
  );
  
module.exports = router;