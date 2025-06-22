const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');

// GET /api/notifications - Obtener notificaciones del usuario
router.get('/notifications', authenticateToken, async (req, res) => {
    const userId = req.userId;
    try {
        const notifications = await prisma.notification.findMany({
            where: { recipientId: userId },
            orderBy: { createdAt: 'desc' },
            take: 20, // Limitar a las 20 más recientes
            select: {
                id: true,
                type: true,
                isRead: true,
                createdAt: true,
                postId: true,
                communityId: true,
                actor: {
                    select: {
                        id: true,
                        username: true,
                        avatarUrl: true
                    }
                }
            }
        });

        const unreadCount = await prisma.notification.count({
            where: {
                recipientId: userId,
                isRead: false
            }
        });

        res.status(200).json({ notifications, unreadCount });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Error al obtener las notificaciones.' });
    }
});

// POST /api/notifications/mark-as-read - Marcar notificaciones como leídas
router.post('/notifications/mark-as-read', authenticateToken, async (req, res) => {
    const userId = req.userId;
    const { notificationIds } = req.body; // Espera un array de IDs

    if (!notificationIds || !Array.isArray(notificationIds)) {
        return res.status(400).json({ error: 'Se requiere un array de notificationIds.' });
    }

    try {
        await prisma.notification.updateMany({
            where: {
                id: { in: notificationIds },
                recipientId: userId // Asegurarse que el usuario solo marque sus propias notificaciones
            },
            data: { isRead: true }
        });
        res.status(200).json({ message: 'Notificaciones marcadas como leídas.' });
    } catch (error) {
        console.error('Error marking notifications as read:', error);
        res.status(500).json({ error: 'Error al marcar las notificaciones.' });
    }
});

module.exports = router;