// routes/subscriptions.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');
const { param, validationResult } = require('express-validator');
const { RoleInCommunity } = require('@prisma/client'); // Para usar el Enum de Rol

router.post(
    '/comunidades/:communityId/suscripcion',
    authenticateToken,
    [
        param('communityId').isMongoId().withMessage('ID de comunidad inválido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const communityId = req.params.communityId;
        const userId = req.userId;
  
        console.log(`>>> (subscriptions.routes.js) Usuario ID ${userId} intentando suscribirse a premium de Comunidad ID ${communityId}`);
        try {
            // 1. Verificar que la comunidad exista
            const communityExists = await prisma.community.findUnique({
                where: { id: communityId },
                select: { id: true }
            });
            if (!communityExists) {
                return res.status(404).json({ error: 'Comunidad no encontrada para suscribirse.' });
            }
  
            // 2. Obtener el usuario y sus suscripciones actuales
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { suscritoAComunidadesIds: true }
            });
            if (!user) { // Esto no debería pasar si authenticateToken funciona
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }

            // 3. Verificar si el usuario ya es miembro de la comunidad. Si no, añadirlo.
            const existingMembership = await prisma.communityMembership.findUnique({
                where: {
                    userId_communityId: {
                        userId: userId,
                        communityId: communityId
                    }
                }
            });

            if (!existingMembership) {
                // Si no es miembro, lo hacemos miembro con rol por defecto
                await prisma.communityMembership.create({
                    data: {
                        userId: userId,
                        communityId: communityId,
                        role: RoleInCommunity.MEMBER // Rol por defecto al suscribirse a premium si no era miembro
                    }
                });
                console.log(`>>> (subscriptions.routes.js) Usuario ID ${userId} añadido como MIEMBRO a Comunidad ID ${communityId} como parte de la suscripción premium.`);
            }
            
            // 4. Proceder con la suscripción premium (añadir a suscritoAComunidadesIds)
            if (user.suscritoAComunidadesIds.includes(communityId)) {
                // Si ya estaba suscrito a premium y también era miembro (o se acaba de hacer), informar.
                return res.status(200).json({ mensaje: 'Ya estás suscrito al contenido premium de esta comunidad.' });
            }
  
            await prisma.user.update({
                where: { id: userId },
                data: { suscritoAComunidadesIds: { push: communityId } }
            });
            
            // Si no era miembro antes, el mensaje podría reflejar ambas acciones
            const mensaje = existingMembership 
                ? 'Suscripción al contenido premium realizada con éxito.'
                : 'Te has unido a la comunidad y suscrito a su contenido premium con éxito.';
            res.status(200).json({ mensaje: mensaje });

        } catch (error) {
            console.error(`❌ (subscriptions.routes.js) Error en POST /comunidades/${communityId}/suscripcion:`, error);
            if (error.code === 'P2025') { // Foreign key constraint o record to update not found
                 return res.status(404).json({ error: 'Usuario o Comunidad no encontrado para realizar la suscripción.', detalle: error.message });
            }
            res.status(500).json({ error: 'Error interno al procesar la suscripción.', detalle: error.message });
        }
    }
  );
  
// El endpoint DELETE para cancelar suscripción no necesita cambiar su lógica fundamental,
// ya que solo quita de suscritoAComunidadesIds. No elimina la membresía.
router.delete(
    '/comunidades/:communityId/suscripcion',
    authenticateToken,
    [ /* ... validaciones ... */ ],
    async (req, res) => {
        // ... (lógica existente sin cambios) ...
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const communityId = req.params.communityId;
        const userId = req.userId;
  
        console.log(`>>> (subscriptions.routes.js) Usuario ID ${userId} intentando cancelar suscripción a Comunidad ID ${communityId}`);
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { suscritoAComunidadesIds: true }
            });
  
            if (!user || !user.suscritoAComunidadesIds || !user.suscritoAComunidadesIds.includes(communityId)) {
                 return res.status(200).json({ mensaje: 'No estabas suscrito al contenido premium de esta comunidad.'});
            }
  
            const nuevasSuscripciones = user.suscritoAComunidadesIds.filter(id => id !== communityId);
  
            await prisma.user.update({
                where: { id: userId },
                data: { suscritoAComunidadesIds: { set: nuevasSuscripciones } } 
            });
            res.status(200).json({ mensaje: 'Suscripción al contenido premium cancelada con éxito.' });
        } catch (error) { /* ... manejo de errores ... */ }
    }
  );
  
module.exports = router;