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


// --- Endpoint para Crear una Publicación (Post) dentro de una Comunidad ---
router.post(
  '/comunidades/:communityId/posts',
  authenticateToken,
  upload.single('postImage'), // Middleware de Multer para el campo 'postImage'
  [
    param('communityId').isMongoId().withMessage('El ID de la comunidad no es válido.'),
    body('title').trim().notEmpty().withMessage('El título es obligatorio.'),
    body('content').trim().notEmpty().withMessage('El contenido es obligatorio.'),
    body('esPremium').optional().isBoolean().withMessage('esPremium debe ser booleano (true/false).').toBoolean()
  ],
  async (req, res) => {
    // Manejo de error de validación de tipo de archivo de Multer
    if (req.fileValidationError) {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path); // Eliminar archivo temporal si la validación del tipo falló
      }
      return res.status(400).json({ errors: [{ msg: req.fileValidationError, path: 'postImage', location: 'file' }] });
    }
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Si hay errores de validación de express-validator, y se subió un archivo, eliminarlo.
        if (req.file && req.file.path && fs.existsSync(req.file.path)) { 
            fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ errors: errors.array() });
    }

    const communityId = req.params.communityId;
    const authorId = req.userId; // ID del usuario que hace la petición
    const { title, content, esPremium } = req.body;

    let tempFilePath = req.file ? req.file.path : null;
    let cloudinaryResponse = null;

    console.log(`BACKEND (Crear Post): Usuario ${authorId} intentando postear en comunidad ${communityId}. Premium: ${esPremium}`);

    try {
        // 1. Verificar que la comunidad exista
        const comunidadExistente = await prisma.community.findUnique({
            where: { id: communityId },
            select: { id: true, createdById: true }
        });

        if (!comunidadExistente) {
            if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            return res.status(404).json({ error: 'Comunidad no encontrada.' });
        }

        // 2. Verificar permisos para crear posts en esta comunidad
        let userMembershipInCommunity = null;
        let canPost = false;

        if (comunidadExistente.createdById === authorId) { // El usuario es el CREADOR de la comunidad
            canPost = true;
            console.log(`BACKEND (Crear Post): Usuario ${authorId} es CREATOR de la comunidad ${communityId}.`);
        } else { // Verificar si es MODERATOR
            userMembershipInCommunity = await prisma.communityMembership.findUnique({
                where: { userId_communityId: { userId: authorId, communityId: communityId } },
                // Seleccionar role y el nuevo permiso canPublishPremiumContent
                select: { role: true, canPublishPremiumContent: true }
            });
            if (userMembershipInCommunity && userMembershipInCommunity.role === RoleInCommunity.MODERATOR) {
                canPost = true;
            }
        }

        if (!canPost) {
            if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            console.log(`BACKEND (Crear Post): Usuario ${authorId} (Membresía: ${JSON.stringify(userMembershipInCommunity)}) no tiene permiso para postear en ${communityId}.`);
            return res.status(403).json({ error: 'No tienes permiso para crear publicaciones en esta comunidad. Solo creadores o moderadores pueden.' });
        }
        console.log(`BACKEND (Crear Post): Usuario ${authorId} (Rol en comunidad inferido o Creador) tiene permiso para crear post.`);

        // 3. Verificar permiso para marcar como premium
          let canMarkAsPremium = false;
    if (esPremium === true) {
        const autorDetails = await prisma.user.findUnique({
            where: { id: authorId },
            select: { tipo_usuario: true }
        });
        
        // Se cambia la comprobación de 'GURU' a UserType.OG
        if (autorDetails && autorDetails.tipo_usuario === UserType.OG) {
            canMarkAsPremium = true;
        } else if (userMembershipInCommunity && userMembershipInCommunity.role === RoleInCommunity.MODERATOR && userMembershipInCommunity.canPublishPremiumContent === true) {
            canMarkAsPremium = true;
        }

        if (!canMarkAsPremium) {
            if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            return res.status(403).json({ error: 'No tienes permiso para marcar este post como premium.' });
        }
    }

        // 4. Subir imagen a Cloudinary si existe
        if (tempFilePath) {
            try {
                console.log(`BACKEND (Crear Post): Subiendo ${tempFilePath} a Cloudinary...`);
                cloudinaryResponse = await uploadToCloudinary(tempFilePath, "bulk_posts"); // Carpeta "bulk_posts" en Cloudinary
                console.log(`BACKEND (Crear Post): Imagen subida a Cloudinary: ${cloudinaryResponse.url}`);
            } catch (uploadError) {
                console.error("BACKEND (Crear Post): Error subiendo imagen a Cloudinary:", uploadError);
                // No es necesario borrar tempFilePath aquí, el finally general se encargará
                return res.status(500).json({ error: 'Error al subir la imagen del post.', detalle: uploadError.message });
            } finally {
                // Siempre eliminar el archivo temporal después del intento de subida a Cloudinary
                if (fs.existsSync(tempFilePath)) { 
                    fs.unlinkSync(tempFilePath);
                    console.log(`BACKEND (Crear Post): Archivo temporal ${tempFilePath} eliminado.`);
                }
            }
        }

        // 5. Crear el post en la base de datos
        const dataToCreate = {
            title: title.trim(), 
            content: content.trim(),
            author: { connect: { id: authorId } },
            community: { connect: { id: communityId } },
            // Asignar esPremium solo si se solicitó Y se tiene permiso
            esPremium: (esPremium === true && canMarkAsPremium) ? true : false 
        };

        if (cloudinaryResponse) {
            dataToCreate.imageUrl = cloudinaryResponse.url;
            dataToCreate.imagePublicId = cloudinaryResponse.public_id;
        }

        const nuevoPost = await prisma.post.create({
            data: dataToCreate,
            select: { // Asegúrate que este select devuelva lo que el frontend espera
                id: true, title: true, content: true, esPremium: true, createdAt: true, updatedAt: true,
                imageUrl: true,
                author: { select: { id: true, email: true, tipo_usuario: true, avatarUrl: true } },
                community: { select: { id: true, name: true, logoUrl: true } },
                 _count: { select: { comments: true, reactions: true } } 
            }
        });
        console.log(`BACKEND (Crear Post): Post ${nuevoPost.id} creado. esPremium: ${nuevoPost.esPremium}. Autor ID: ${authorId}. Comunidad ID: ${communityId}`);
        res.status(201).json(nuevoPost);

    } catch (error) {
        console.error(`❌ BACKEND (Crear Post): Error general en POST /comunidades/${communityId}/posts:`, error);
        // Si hubo un error DESPUÉS de subir a Cloudinary pero ANTES de guardar en DB, intentar rollback de Cloudinary
        if (cloudinaryResponse && error) { // 'error' implica que la operación de DB falló
            console.warn(`BACKEND (Crear Post): Imagen ${cloudinaryResponse.public_id} subida a Cloudinary pero ocurrió error posterior en DB. Intentando eliminar de Cloudinary...`);
            try {
                await deleteFromCloudinary(cloudinaryResponse.public_id);
                console.log(`BACKEND (Crear Post): Imagen ${cloudinaryResponse.public_id} eliminada de Cloudinary (rollback).`);
            } catch (rollbackError) {
                console.error(`BACKEND (Crear Post): Fallo al eliminar imagen ${cloudinaryResponse.public_id} de Cloudinary durante el rollback:`, rollbackError);
            }
        }
        // Asegurarse de que el archivo temporal se elimine si no se manejó en el finally de Cloudinary (ej. error antes)
        // El `finally` dentro del try de Cloudinary ya debería haberlo manejado si se llegó a ese bloque.
        // Este es un safeguard adicional si el error ocurrió antes de intentar la subida a Cloudinary.
        else if (tempFilePath && fs.existsSync(tempFilePath)) {
             fs.unlinkSync(tempFilePath);
             console.log(`BACKEND (Crear Post): Archivo temporal ${tempFilePath} eliminado en catch general (probablemente error pre-Cloudinary).`);
        }

        if (error.code === 'P2025') { // Error de Prisma por referencia no encontrada
             return res.status(404).json({ error: 'Autor o Comunidad no encontrados al intentar crear el post (referencia inválida).', detalle: error.message });
        }
        res.status(500).json({ error: 'Error interno al crear la publicación.', detalle: error.message });
    }
  }
);


// --- Endpoint para Listar Publicaciones de una Comunidad (VERSIÓN CORREGIDA Y DEFINITIVA) ---
router.get(
    '/comunidades/:communityId/posts',
    authenticateToken,
    [
      param('communityId').isMongoId().withMessage('El ID de la comunidad no es válido.')
    ],
    async (req, res) => {
      console.log("\n--- [DEBUG] INICIO: Petición a GET /comunidades/:communityId/posts ---");
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
          console.log("--- [DEBUG] ERROR: Validación de parámetros falló.");
          return res.status(400).json({ errors: errors.array() });
      }
      
      const communityId = req.params.communityId;
      const userId = req.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      
      console.log(`--- [DEBUG] Parámetros: communityId=${communityId}, userId=${userId}, page=${page}`);

      try {
          const whereCondition = { communityId: communityId };
          console.log("--- [DEBUG] 1. 'whereCondition' construida:", whereCondition);

          const selectClause = {
              id: true,
              title: true,
              content: true,
              esPremium: true,
              createdAt: true,
              imageUrl: true,
              community: { select: { id: true, name: true } },
              _count: { select: { comments: true, reactions: true } },
              author: { 
                  select: { 
                      id: true, 
                      name: true,
                      username: true,
                      avatarUrl: true
                  } 
              },
              reactions: {
                  where: { userId: userId },
                  select: { id: true }
              }
          };
          console.log("--- [DEBUG] 2. 'selectClause' construida. A punto de ejecutar prisma.post.findMany...");

          const postsFromDb = await prisma.post.findMany({
              where: whereCondition,
              orderBy: { createdAt: 'desc' },
              skip: skip, 
              take: limit,
              select: selectClause
          });

          console.log(`--- [DEBUG] 3. Éxito en prisma.post.findMany. Se encontraron ${postsFromDb.length} posts.`);

          const posts = postsFromDb.map(post => {
              const { reactions, ...restOfPost } = post;
              return {
                  ...restOfPost,
                  userHasLiked: reactions.length > 0
              };
          });

          console.log("--- [DEBUG] 4. Posts mapeados para añadir 'userHasLiked'. A punto de ejecutar prisma.post.count...");

          const totalPosts = await prisma.post.count({ where: whereCondition });

          console.log(`--- [DEBUG] 5. Éxito en prisma.post.count. Total de posts: ${totalPosts}. A punto de enviar respuesta.`);
          
          const totalPages = Math.ceil(totalPosts / limit);
          
          res.status(200).json({ posts, currentPage: page, totalPages, totalPosts });
          console.log("--- [DEBUG] FIN: Respuesta enviada exitosamente. ---");

      } catch (error) {
          // Si el código llega aquí, este log nos dará el error exacto de Prisma.
          console.error("--- [DEBUG] ERROR FATAL ATRAPADO EN EL BLOQUE CATCH ---");
          console.error(error); // Imprimimos el objeto de error COMPLETO
          res.status(500).json({ error: 'Error interno al obtener la lista de publicaciones.', detalle: error.message });
      }
    });


// --- Endpoint para Ver los Detalles de una Publicación Específica ---
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
          authorId: true,    // Selecciona el scalar authorId
          imageUrl: true,
          imagePublicId: true, // Mantén si lo usas o planeas usar
          author: { 
              select: { 
                  id: true, 
                  email: true, 
                  tipo_usuario: true, 
                  avatarUrl: true // Añadido para el frontend
              } 
          },
          community: { 
              select: { 
                  id: true, 
                  name: true, 
                  logoUrl: true,     // Añadido para el frontend
                  createdById: true  // Añadido para permisos de eliminar comentario en frontend
              } 
          },
        }
      });

      if (!post) {
        return res.status(404).json({ error: 'Publicación no encontrada.' });
      }

      let userHasLikedThisPost = false;
      if (userId) { 
        // --- CAMBIO IMPORTANTE: Usar findFirst en lugar de findUnique ---
        const reaction = await prisma.reaction.findFirst({ 
          where: {
            userId: userId,
            postId: postId,
            type: ReactionType.LIKE // Asegúrate que ReactionType.LIKE sea el string correcto (ej. "LIKE")
          },
          select: { id: true } // Solo necesitamos saber si existe
        });
        // --- FIN DE CAMBIO IMPORTANTE ---
        if (reaction) {
          userHasLikedThisPost = true;
        }
      }
      console.log(`BACKEND (GET /posts/:postId): Usuario ${userId} ${userHasLikedThisPost ? 'SÍ' : 'NO'} ha dado like al post ${postId}.`);

      // Lógica de acceso a post premium (sin cambios)
      if (post.esPremium) {
        if (!userId) {
          return res.status(401).json({ error: 'Se requiere autenticación para ver este post premium.' });
        }
        if (post.authorId !== userId) {
          const userRequesting = await prisma.user.findUnique({
            where: { id: userId },
            select: { suscritoAComunidadesIds: true }
          });
          const isSubscribed = userRequesting?.suscritoAComunidadesIds?.includes(post.communityId) ?? false;
          if (!isSubscribed) {
            return res.status(403).json({ error: 'Acceso denegado. Se requiere suscripción a la comunidad para ver este post premium.' });
          }
        }
      }

      // Conteos (sin cambios)
      const likesCount = await prisma.reaction.count({
        where: { postId: postId, type: ReactionType.LIKE }
      });
      const commentsCount = await prisma.comment.count({
        where: { postId: postId }
      });

      res.status(200).json({
        ...post,
        likesCount,
        commentsCount,
        userHasLiked: userHasLikedThisPost
      });

    } catch (error) {
      console.error(`❌ (posts.routes.js) Error en GET /posts/${postId}:`, error);
      if (error.code === 'P2023' && error.message?.includes("Malformed ObjectID")) {
        return res.status(400).json({ error: 'El formato del ID de la publicación es inválido.' });
      }
      res.status(500).json({ error: 'Error al obtener los detalles de la publicación.', detalle: error.message });
    }
  }
);


// --- Endpoint para Actualizar una Publicación (Post) ---
// Ruta: PUT /posts/:postId
// NOTA: La actualización de la imagen no está implementada en este endpoint por simplicidad para el MVP.
// Si se quisiera, se tendría que añadir multer y lógica para borrar la imagen antigua de Cloudinary y subir la nueva.
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
// Ruta: DELETE /posts/:postId
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