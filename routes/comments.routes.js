// routes/comments.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');
const { param, body, validationResult } = require('express-validator');
const { RoleInCommunity } = require('@prisma/client');

// --- Endpoint para Crear un Comentario en un Post ---
// Ruta: POST /posts/:postId/comments
router.post(
  '/posts/:postId/comments',
  authenticateToken,
  [
      param('postId').isMongoId().withMessage('ID de publicación inválido.'),
      body('content').trim().notEmpty().withMessage('El contenido no puede estar vacío.')
  ],
  async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
      }
      const postId = req.params.postId;
      const authorId = req.userId; // Usuario que crea el comentario
      const { content } = req.body;

      console.log(`BACKEND (Crear Comentario): Usuario ID ${authorId} intentando comentar en Post ID ${postId}`);
      try {
          // 1. Verificar que el post exista y obtener su communityId
          const post = await prisma.post.findUnique({
              where: { id: postId },
              select: { id: true, communityId: true } // Necesitamos communityId
          });

          if (!post) {
              return res.status(404).json({ error: 'No se puede comentar en una publicación que no existe.' });
          }

          // 2. Verificar si el usuario es miembro de la comunidad a la que pertenece el post
          const communityIdDelPost = post.communityId;
          const membership = await prisma.communityMembership.findUnique({
              where: {
                  userId_communityId: { // Usando el índice único combinado
                      userId: authorId,
                      communityId: communityIdDelPost
                  }
              },
              select: { id: true } // Solo necesitamos saber si existe la membresía
          });

          if (!membership) {
              console.log(`BACKEND (Crear Comentario): Usuario ${authorId} no es miembro de la comunidad ${communityIdDelPost}. Comentario denegado.`);
              return res.status(403).json({ error: 'Debes ser miembro de la comunidad para poder comentar en sus posts.' });
          }
          console.log(`BACKEND (Crear Comentario): Usuario ${authorId} es miembro de la comunidad ${communityIdDelPost}. Comentario permitido.`);

          // 3. Crear el comentario (lógica existente)
          const nuevoComentario = await prisma.comment.create({
              data: {
                  content: content,
                  author: { connect: { id: authorId } },
                  post: { connect: { id: postId } }
              },
              select: { // Asegúrate que este select devuelva lo que el frontend espera
                  id: true, content: true, createdAt: true, updatedAt: true, postId: true,
                  author: { select: { id: true, email: true, avatarUrl: true }} // Incluir avatarUrl
              }
          });
          res.status(201).json(nuevoComentario);
      } catch (error) {
          console.error(`❌ BACKEND (Crear Comentario): Error en POST /posts/${postId}/comments:`, error);
          if (error.code === 'P2025') { // Error de Prisma por referencia no encontrada
               return res.status(404).json({ error: 'Post o autor no encontrados al intentar crear el comentario.', detalle: error.message });
          } else if (error.code === 'P2003') { // Foreign key constraint failed
               return res.status(400).json({ error: 'Referencia a Post o Autor inválida al crear el comentario.', detalle: error.message });
          }
          res.status(500).json({ error: 'Error interno al crear el comentario.', detalle: error.message });
      }
  }
);

// --- Endpoint para Listar Comentarios de un Post (CORREGIDO) ---
router.get(
    '/posts/:postId/comments',
    [
        param('postId').isMongoId().withMessage('ID de publicación inválido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const postId = req.params.postId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const skip = (page - 1) * limit;
  
        try {
            const postExists = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
            if (!postExists) {
                return res.status(404).json({ error: 'Publicación no encontrada.' });
            }
  
            // === INICIO DE LA CORRECCIÓN DE LA CONSULTA ===
            const comments = await prisma.comment.findMany({
                where: { postId: postId },
                orderBy: { createdAt: 'asc' }, // Volvemos a 'asc' (más antiguos primero) para asegurar estabilidad.
                skip: skip,
                take: limit,
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true, // Aseguramos que todos los campos del modelo estén
                    author: {
                        select: { 
                            id: true, 
                            name: true,       // Mantenemos la adición de name
                            username: true,   // Mantenemos la adición de username
                            avatarUrl: true
                        }
                    }
                }
            });
            // === FIN DE LA CORRECCIÓN DE LA CONSULTA ===
  
            const totalComments = await prisma.comment.count({
                where: { postId: postId }
            });
            const totalPages = Math.ceil(totalComments / limit);
  
            res.status(200).json({
                comments: comments,
                currentPage: page,
                totalPages: totalPages,
                totalComments: totalComments
            });
        } catch (error) {
            console.error(`Error en GET /posts/${postId}/comments:`, error);
            res.status(500).json({ error: 'Error interno al obtener los comentarios.', detalle: error.message });
        }
    }
);
  
// --- Endpoint para Actualizar un Comentario ---
// Ruta: PUT /comments/:commentId
router.put(
    '/comments/:commentId',
    authenticateToken,
    [
        param('commentId').isMongoId().withMessage('ID de comentario inválido.'),
        body('content').trim().notEmpty().withMessage('El contenido no puede estar vacío.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const commentId = req.params.commentId;
        const userId = req.userId; // Usuario que realiza la petición (debe ser el autor del comentario)
        const { content } = req.body;
  
        console.log(`>>> (comments.routes.js) Usuario ID ${userId} actualizando Comentario ID ${commentId}`);
        try {
            // 1. Verificar que el comentario exista y que el usuario sea el autor
            const comentarioExistente = await prisma.comment.findUnique({
                where: { id: commentId },
                select: { authorId: true }
            });
  
            if (!comentarioExistente) {
                return res.status(404).json({ error: 'Comentario no encontrado.' });
            }
  
            if (comentarioExistente.authorId !== userId) {
                // Solo el autor original puede actualizar su comentario
                return res.status(403).json({ error: 'No tienes permiso para editar este comentario.' });
            }
  
            // 2. Realizar la actualización
            const comentarioActualizado = await prisma.comment.update({
                where: { id: commentId },
                data: { content: content },
                select: { // Definir qué campos devolver
                    id: true, content: true, createdAt: true, updatedAt: true, postId: true,
                    author: { select: { id: true, email: true, avatarUrl: true } }
                }
            });
            res.status(200).json(comentarioActualizado);
        } catch (error) {
            console.error(`❌ (comments.routes.js) Error en PUT /comments/${commentId}:`, error);
            if (error.code === 'P2025') { // "Record to update not found"
                 return res.status(404).json({ error: 'Comentario no encontrado para actualizar.', detalle: error.message });
            }
            res.status(500).json({ error: 'Error interno al actualizar el comentario.', detalle: error.message });
        }
    }
  );

// --- Endpoint para Eliminar un Comentario ---
// Ruta: DELETE /comments/:commentId
router.delete(
    '/comments/:commentId',
    authenticateToken,
    [
        param('commentId').isMongoId().withMessage('ID de comentario inválido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { commentId } = req.params;
        const userId = req.userId; // Usuario que realiza la petición

        console.log(`>>> (comments.routes.js) Usuario ID ${userId} intentando eliminar Comentario ID ${commentId}`);
        try {
            // 1. Buscar el comentario y la información relevante para permisos
            const comentario = await prisma.comment.findUnique({
                where: { id: commentId },
                select: {
                    authorId: true,
                    postId: true, // Necesitamos el postId para encontrar la comunidad
                    post: {       // Incluir el post para obtener su communityId
                        select: {
                            communityId: true
                        }
                    }
                }
            });

            if (!comentario) {
                return res.status(404).json({ error: 'Comentario no encontrado.' });
            }

            if (!comentario.post || !comentario.post.communityId) {
                // Esto indica una inconsistencia en los datos, el comentario debería estar ligado a un post con comunidad
                console.error(`Error: Comentario ${commentId} no está correctamente vinculado a un post con comunidad.`);
                return res.status(500).json({ error: 'Error interno: El comentario no está vinculado a una comunidad válida.' });
            }

            const communityIdDelPost = comentario.post.communityId;

            // 2. Verificar si el usuario es el autor del comentario
            if (comentario.authorId === userId) {
                await prisma.comment.delete({
                    where: { id: commentId }
                });
                console.log(`✅ (comments.routes.js) Comentario ID ${commentId} eliminado por su autor (Usuario ID ${userId}).`);
                return res.status(200).json({ mensaje: 'Comentario eliminado exitosamente por el autor.' });
            }

            // 3. Si no es el autor, verificar si es CREATOR o MODERATOR de la comunidad del post
            const membership = await prisma.communityMembership.findUnique({
                where: {
                    userId_communityId: { // Usar el índice compuesto
                        userId: userId,
                        communityId: communityIdDelPost
                    }
                },
                select: {
                    role: true
                }
            });

            if (membership && (membership.role === RoleInCommunity.CREATOR || membership.role === RoleInCommunity.MODERATOR)) {
                await prisma.comment.delete({
                    where: { id: commentId }
                });
                console.log(`✅ (comments.routes.js) Comentario ID ${commentId} eliminado por ${membership.role} (Usuario ID ${userId}) de la Comunidad ID ${communityIdDelPost}.`);
                return res.status(200).json({ mensaje: `Comentario eliminado exitosamente por un ${membership.role.toLowerCase()} de la comunidad.` });
            }

            // 4. Si no es ninguna de las anteriores, no tiene permiso
            console.log(`>>> (comments.routes.js) Acceso denegado para Usuario ID ${userId} al intentar eliminar Comentario ID ${commentId}. No es autor ni moderador/creador cualificado.`);
            return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario.' });

        } catch (error) {
            console.error(`❌ (comments.routes.js) Error en DELETE /comments/${commentId}:`, error);
            if (error.code === 'P2025') { // "Record to delete not found"
                 return res.status(404).json({ error: 'Comentario no encontrado para eliminar o ya fue eliminado.', detalle: error.message });
            }
            res.status(500).json({ error: 'Error interno al eliminar el comentario.', detalle: error.message });
        }
    }
);

module.exports = router;