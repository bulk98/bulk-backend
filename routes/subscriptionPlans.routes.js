const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');
const { body, param, validationResult } = require('express-validator');

// Middleware de ayuda para verificar que el usuario es el creador de la comunidad
const isCommunityCreator = async (req, res, next) => {
    try {
        const communityId = req.params.communityId;
        const userId = req.userId;

        const community = await prisma.community.findUnique({
            where: { id: communityId },
            select: { createdById: true }
        });

        if (!community) {
            return res.status(404).json({ error: 'Comunidad no encontrada.' });
        }

        if (community.createdById !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para gestionar los planes de esta comunidad.' });
        }

        next(); // El usuario es el creador, puede continuar.
    } catch (error) {
        res.status(500).json({ error: 'Error al verificar los permisos de la comunidad.' });
    }
};

/**
 * @route   POST /api/communities/:communityId/plans
 * @desc    Crear un nuevo plan de suscripción para una comunidad
 * @access  Privado (Solo Creador)
 */
router.post(
    '/communities/:communityId/plans',
    authenticateToken,
    isCommunityCreator, // <-- Middleware de seguridad
    [
        body('name').trim().notEmpty().withMessage('El nombre del plan es obligatorio.'),
        body('price').isFloat({ min: 0 }).withMessage('El precio debe ser un número válido.'),
        body('description').optional().trim()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { communityId } = req.params;
        const { name, description, price, currency, interval } = req.body;

        try {
            const newPlan = await prisma.subscriptionPlan.create({
                data: {
                    name,
                    description,
                    price: parseFloat(price),
                    currency: currency || 'USD',
                    interval: interval || 'month',
                    communityId: communityId
                }
            });
            res.status(201).json(newPlan);
        } catch (error) {
            console.error('Error al crear el plan de suscripción:', error);
            res.status(500).json({ error: 'No se pudo crear el plan de suscripción.' });
        }
    }
);

/**
 * @route   GET /api/communities/:communityId/plans
 * @desc    Obtener todos los planes de suscripción de una comunidad
 * @access  Privado (Solo Creador)
 */
router.get(
    '/communities/:communityId/plans',
    authenticateToken,
    isCommunityCreator,
    async (req, res) => {
        try {
            const plans = await prisma.subscriptionPlan.findMany({
                where: { communityId: req.params.communityId },
                orderBy: { price: 'asc' }
            });
            res.status(200).json(plans);
        } catch (error) {
            console.error('Error al obtener los planes de suscripción:', error);
            res.status(500).json({ error: 'No se pudieron obtener los planes.' });
        }
    }
);

/**
 * @route   PUT /api/plans/:planId
 * @desc    Actualizar un plan de suscripción específico
 * @access  Privado (Solo Creador)
 */
router.put(
    '/plans/:planId',
    authenticateToken,
    [ body('name').optional().trim().notEmpty(), body('price').optional().isFloat({ min: 0 }) ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        try {
            const plan = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.planId }, select: { community: { select: { createdById: true } } }});
            if (!plan) return res.status(404).json({ error: 'Plan no encontrado.' });
            if (plan.community.createdById !== req.userId) return res.status(403).json({ error: 'No tienes permiso para editar este plan.' });
            
            const updatedPlan = await prisma.subscriptionPlan.update({
                where: { id: req.params.planId },
                data: req.body
            });
            res.status(200).json(updatedPlan);
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar el plan.' });
        }
    }
);

/**
 * @route   DELETE /api/plans/:planId
 * @desc    Eliminar un plan de suscripción
 * @access  Privado (Solo Creador)
 */
router.delete(
    '/plans/:planId',
    authenticateToken,
    async (req, res) => {
        try {
            const plan = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.planId }, select: { community: { select: { createdById: true } } }});
            if (!plan) return res.status(404).json({ error: 'Plan no encontrado.' });
            if (plan.community.createdById !== req.userId) return res.status(403).json({ error: 'No tienes permiso para eliminar este plan.' });
            
            await prisma.subscriptionPlan.delete({
                where: { id: req.params.planId }
            });
            res.status(204).send(); // 204 No Content
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar el plan.' });
        }
    }
);

module.exports = router;