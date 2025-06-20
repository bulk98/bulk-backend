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
const { UserType, RoleInCommunity } = require('@prisma/client');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const { ReactionType } = require('../constants/reactions');

// --- Configuración de Multer (sin cambios) ---
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
    req.fileValidationError = 'Tipo de archivo no soportado. Solo imágenes (JPEG, PNG, GIF, WEBP) son permitidas.';
    cb(null, false);
  }
};
const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 10 },
  fileFilter: fileFilter
});


// --- Endpoint para Crear una Publicación (VERSIÓN CON LÓGICA CORREGIDA) ---
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
    const { title, content, esPremium } = req.body;

    // --- INICIO DE SECCIÓN DE DEBUG ---
    console.log("\n--- DEBUG: INICIANDO CREACIÓN DE POST ---");
    console.log(`Petición para Comunidad ID: ${communityId}`);
    console.log(`Usuario (autor) ID: ${authorId}`);
    console.log(`Valor de 'esPremium' recibido en req.body:`, esPremium, `(Tipo: ${typeof esPremium})`);
    // --- FIN DE SECCIÓN DE DEBUG ---

    let tempFilePath = req.file ? req.file.path : null;
    let cloudinaryResponse = null;

    try {
        const [comunidad, userMembership] = await Promise.all([
            prisma.community.findUnique({ where: { id: communityId }, select: { createdById: true } }),
            prisma.communityMembership.findUnique({ where: { userId_communityId: { userId: authorId, communityId: communityId } }, select: { role: true, canPublishPremiumContent: true } })
        ]);

        // --- INICIO DE SECCIÓN DE DEBUG ---
        console.log("--- DEBUG: DATOS DE LA BASE DE DATOS ---");
        if (!comunidad) {
            console.log("Resultado de 'comunidad': null o undefined. ¡COMUNIDAD NO ENCONTRADA!");
        } else {
            console.log(`Resultado de 'comunidad':`, { createdById: comunidad.createdById });
        }
        console.log(`Resultado de 'userMembership':`, userMembership);
        // --- FIN DE SECCIÓN DE DEBUG ---

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
        
        const canMarkAsPremium = isCreator || (isModerator && userMembership?.canPublishPremiumContent === true);
        const intendsToPostPremium = esPremium === 'true';
        const finalIsPremium = canMarkAsPremium && intendsToPostPremium;

        // --- INICIO DE SECCIÓN DE DEBUG ---
        console.log("--- DEBUG: EVALUACIÓN DE PERMISOS ---");
        console.log(`Valor de 'isCreator': ${isCreator}`);
        console.log(`Valor de 'isModerator': ${isModerator}`);
        console.log(`Valor de 'intendsToPostPremium' (intención del usuario): ${intendsToPostPremium}`);
        console.log(`Valor de 'canMarkAsPremium' (permiso del usuario): ${canMarkAsPremium}`);
        console.log(`===> VALOR FINAL PARA 'esPremium' EN DB: ${finalIsPremium} <===`);
        // --- FIN DE SECCIÓN DE DEBUG ---

        if (intendsToPostPremium && !canMarkAsPremium) {
            if (tempFilePath) fs.unlinkSync(tempFilePath);
            const errorMessage = isCreator 
                ? 'Error inesperado de permisos para el creador.'
                : 'No tienes permiso para marcar este post como premium.';
            return res.status(403).json({ error: errorMessage });
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
            esPremium: finalIsPremium
        };

        if (cloudinaryResponse) {
            dataToCreate.imageUrl = cloudinaryResponse.url;
            dataToCreate.imagePublicId = cloudinaryResponse.public_id;
        }

        const nuevoPost = await prisma.post.create({
            data: dataToCreate,
            select: { id: true, title: true, esPremium: true }
        });
        
        console.log("--- DEBUG: POST CREADO EN DB ---", nuevoPost, "\n");
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


// --- Endpoint para Listar los Posts de una Comunidad (CON DEPURACIÓN) ---
router.get(
  '/comunidades/:communityId/posts',
  authenticateToken,
  [
    param('communityId').isMongoId().withMessage('ID de comunidad inválido.'),
  ],
  async (req, res) => {
    console.log("--- EJECUTANDO RUTA LISTAR POSTS (VERSIÓN DE SEGURIDAD REFORZADA) ---");
    
    const { communityId } = req.params;
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    try {
      const [community, user, postsFromDb, totalPosts] = await Promise.all([
        prisma.community.findUnique({
          where: { id: communityId },
          select: { esPublica: true, createdById: true }
        }),
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            suscritoAComunidadesIds: true,
            memberships: {
              where: { communityId: communityId },
              select: { role: true }
            }
          }
        }),
        prisma.post.findMany({
          where: { communityId: communityId },
          orderBy: { createdAt: 'desc' },
          skip, take: limit,
          select: {
            id: true, title: true, content: true, esPremium: true, createdAt: true, imageUrl: true, authorId: true,
            author: { select: { id: true, name: true, username: true, avatarUrl: true } },
            community: { select: { id: true, name: true, logoUrl: true } },
            _count: { select: { comments: true } },
            reactions: { where: { userId: userId, type: 'LIKE' } }
          }
        }),
        prisma.post.count({ where: { communityId: communityId } })
      ]);

      if (!community) return res.status(404).json({ error: 'Comunidad no encontrada.' });

      const membership = user?.memberships?.[0];
      const isCreator = community.createdById === userId;
      const isModerator = membership?.role === 'MODERATOR';
      const isSubscribed = user?.suscritoAComunidadesIds?.includes(communityId) ?? false;
      const isMember = !!membership;
      
      // ===== INICIO DE LOGS DE DEPURACIÓN =====
      console.log(`[PERM CHECK] ID de Usuario Actual: ${userId}`);
      console.log(`[PERM CHECK] ID del Creador de la Comunidad: ${community.createdById}`);
      console.log(`[PERM CHECK] ¿Es el creador? -> ${isCreator}`);
      console.log(`[PERM CHECK] Rol en la comunidad -> ${membership?.role || 'No es miembro'}`);
      console.log(`[PERM CHECK] ¿Es moderador? -> ${isModerator}`);
      console.log(`[PERM CHECK] ¿Está suscrito? -> ${isSubscribed}`);
      // ===== FIN DE LOGS DE DEPURACIÓN =====

      if (!community.esPublica && !isMember) {
        return res.status(403).json({ error: 'Acceso denegado. Esta comunidad es privada.' });
      }

      const processedPosts = postsFromDb.map(post => {
        const userHasPremiumAccess = isCreator || isModerator || isSubscribed;
        
        if (post.esPremium && !userHasPremiumAccess) {
          return { ...post, content: "Este es contenido premium. Suscríbete para desbloquearlo." };
        }
        return post;
      });

      const postsWithLikesCount = await Promise.all(processedPosts.map(async (post) => {
        const { reactions, ...restOfPost } = post;
        const totalLikes = await prisma.reaction.count({ where: { postId: post.id, type: 'LIKE' } });
        return { ...restOfPost, userHasLiked: reactions.length > 0, likesCount: totalLikes };
      }));

      res.status(200).json({
        posts: postsWithLikesCount,
        currentPage: page,
        totalPages: Math.ceil(totalPosts / limit),
        totalPosts: totalPosts
      });

    } catch (error) {
      console.error(`Error en GET /comunidades/${communityId}/posts:`, error);
      res.status(500).json({ error: 'Error interno al obtener los posts.', detalle: error.message });
    }
  }
);



// --- Endpoint para Ver los Detalles de un Post (REFORZADO) ---
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
          id: true, title: true, content: true, esPremium: true, createdAt: true, updatedAt: true, communityId: true, authorId: true, imageUrl: true,
          author: { select: { id: true, name: true, username: true, avatarUrl: true } },
          community: { select: { id: true, name: true, logoUrl: true, createdById: true } }
        }
      });

      if (!post) {
        return res.status(404).json({ error: 'Publicación no encontrada.' });
      }
      
      const isAuthor = post.authorId === userId;
      const isCommunityCreator = post.community.createdById === userId;

      if (post.esPremium && !isAuthor && !isCommunityCreator) {
          const membership = await prisma.communityMembership.findFirst({ where: { userId, communityId: post.communityId } });
          const isModerator = membership?.role === 'MODERATOR';

          if (!isModerator) {
            const userRequesting = await prisma.user.findUnique({
              where: { id: userId },
              select: { suscritoAComunidadesIds: true }
            });
            const isSubscribed = userRequesting?.suscritoAComunidadesIds?.includes(post.communityId) ?? false;
            
            if (!isSubscribed) {
              return res.status(403).json({ error: 'Acceso denegado. Se requiere suscripción para ver este post.' });
            }
          }
      }

      const reaction = await prisma.reaction.findFirst({ where: { userId, postId, type: 'LIKE' }});
      const [likesCount, commentsCount] = await Promise.all([
          prisma.reaction.count({ where: { postId, type: 'LIKE' } }),
          prisma.comment.count({ where: { postId } })
      ]);
      res.status(200).json({ ...post, likesCount, commentsCount, userHasLiked: !!reaction });

    } catch (error) {
      console.error(`Error en GET /posts/${postId}:`, error);
      res.status(500).json({ error: 'Error al obtener los detalles de la publicación.', detalle: error.message });
    }
  }
);


router.put(
    '/posts/:postId',
    authenticateToken,
    [
      param('postId').isMongoId().withMessage("El ID del post no es válido."),
      body('title').optional().trim().notEmpty().withMessage('El título no puede ser vacío si se provee.'),
      body('content').optional().trim().notEmpty().withMessage('El contenido no puede ser vacío si se provee.'),
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
                select: { authorId: true }
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
                     imageUrl: true, imagePublicId: true,
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
                    imagePublicId: true
                }
            });
  
            if (!postToDelete) {
                return res.status(404).json({ error: 'Publicación no encontrada.' });
            }
  
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

            if (postToDelete.imagePublicId) {
                try {
                    console.log(`>>> Intentando eliminar imagen de Cloudinary: ${postToDelete.imagePublicId}`);
                    await deleteFromCloudinary(postToDelete.imagePublicId);
                    console.log(`✅ Imagen ${postToDelete.imagePublicId} eliminada de Cloudinary.`);
                } catch (cloudinaryError) {
                    console.error(`⚠️ Error eliminando imagen ${postToDelete.imagePublicId} de Cloudinary:`, cloudinaryError.message);
                }
            }
            
            await prisma.comment.deleteMany({
                where: { postId: postId }
            });
            console.log(`>>> (posts.routes.js) Comentarios asociados al Post ID ${postId} eliminados.`);
  
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