// routes/reactions.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');
const { param, validationResult } = require('express-validator');
const { ReactionType } = require('../constants/reactions'); // Asegúrate que esto apunte al archivo correcto

router.post(
    '/posts/:postId/react', 
    authenticateToken,
    [
        param('postId').isMongoId().withMessage('El ID del post proporcionado no es válido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { postId } = req.params;
        const userId = req.userId;
        const reactionTypeToToggle = ReactionType.LIKE; // O el string "LIKE" directamente

        try {
            // 1. Verificar que el post exista y obtener su communityId
            const post = await prisma.post.findUnique({
                where: { id: postId },
                select: { id: true, communityId: true } // Necesitamos communityId
            });

            if (!post) {
                return res.status(404).json({ message: 'Post no encontrado.' });
            }

            // 2. Verificar si el usuario es miembro de la comunidad a la que pertenece el post
            const communityIdDelPost = post.communityId;
            const membership = await prisma.communityMembership.findUnique({
                where: {
                    userId_communityId: { // Usando el índice único combinado de CommunityMembership
                        userId: userId,
                        communityId: communityIdDelPost
                    }
                },
                select: { id: true } // Solo necesitamos saber si la membresía existe
            });

            if (!membership) {
                console.log(`BACKEND (Reactions): Usuario ${userId} no es miembro de la comunidad ${communityIdDelPost}. Reacción denegada.`);
                return res.status(403).json({ message: 'Tienes que ser miembro de la comunidad para poder reaccionar a este post.' });
            }
            console.log(`BACKEND (Reactions): Usuario ${userId} es miembro de la comunidad ${communityIdDelPost}. Reacción permitida.`);

            // 3. Lógica para crear/eliminar la reacción (LIKE)
            // Asumimos que la combinación (userId, postId) es única para una reacción de tipo LIKE,
            // o que tu modelo Reaction tiene un constraint único adecuado.
            // Si tu constraint único es (userId, postId, type), ajusta la query.
            const existingReaction = await prisma.reaction.findFirst({ // Usar findFirst es más seguro si el unique constraint es complejo
                where: {
                    userId: userId,
                    postId: postId,
                    type: reactionTypeToToggle 
                }
            });

            if (existingReaction) {
                await prisma.reaction.delete({
                    where: { id: existingReaction.id } // Eliminar por el ID de la reacción
                });
                // Devolver el nuevo conteo de likes
                const newLikesCount = await prisma.reaction.count({ where: { postId, type: reactionTypeToToggle } });
                return res.status(200).json({ 
                    message: `Reacción '${reactionTypeToToggle}' eliminada.`, 
                    reacted: false, 
                    reactionType: reactionTypeToToggle,
                    newTotalLikes: newLikesCount // Devolvemos el nuevo conteo
                });
            } else {
                const newReaction = await prisma.reaction.create({
                    data: {
                        type: reactionTypeToToggle,
                        userId: userId,
                        postId: postId
                    },
                    select: { id: true, type: true }
                });
                // Devolver el nuevo conteo de likes
                const newLikesCount = await prisma.reaction.count({ where: { postId, type: reactionTypeToToggle } });
                return res.status(201).json({ 
                    message: `Reacción '${reactionTypeToToggle}' creada.`, 
                    reacted: true, 
                    reaction: newReaction, 
                    reactionType: reactionTypeToToggle,
                    newTotalLikes: newLikesCount // Devolvemos el nuevo conteo
                });
            }
        } catch (error) {
            console.error(`❌ BACKEND (Reactions): Error en POST /api/posts/${postId}/react:`, error);
            if (error.code === 'P2002') { // Unique constraint failed
                // Esto podría pasar si hubo una condición de carrera o si la lógica de findFirst/delete no fue atómica
                return res.status(409).json({ message: 'Conflicto al procesar la reacción. Inténtalo de nuevo.', detalle: error.message });
            } else if (error.code === 'P2025') { // Record to delete not found o Foreign key constraint failed on create
                return res.status(404).json({ message: 'No se pudo procesar la reacción. Usuario, Post o Recurso relacionado no encontrado.', detalle: error.message });
            }
            res.status(500).json({ message: 'Error interno del servidor al procesar la reacción.', detalle: error.message });
        }
    }
);

module.exports = router;