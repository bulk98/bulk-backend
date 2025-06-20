// routes/search.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');

// GET /api/search?q=termino
router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ communities: [], posts: [], users: [] });
  }

  try {
    const [communities, posts, users] = await Promise.all([
      prisma.community.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } }
          ],
          esPublica: true
        },
        take: 5,
        select: { id: true, name: true }
      }),
      prisma.post.findMany({
        where: {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { content: { contains: q, mode: 'insensitive' } }
          ],
          community: { esPublica: true }
        },
        take: 5,
        select: {
          id: true,
          title: true,
          community: { select: { name: true } }
        }
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { username: { contains: q, mode: 'insensitive' } }
          ]
        },
        take: 5,
        select: { id: true, name: true, username: true, avatarUrl: true }
      })
    ]);

    res.json({ communities, posts, users });
  } catch (error) {
    console.error('❌ Error en búsqueda:', error);
    res.status(500).json({ error: 'Error al buscar.', detalle: error.message });
  }
});

module.exports = router;
