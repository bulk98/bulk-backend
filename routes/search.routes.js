// routes/search.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');

// El endpoint será GET /api/search?q=termino
// No necesita autenticación para que cualquiera pueda buscar, pero se puede añadir `authenticateToken` si se desea.
router.get('/', async (req, res) => {
    const { q } = req.query; // 'q' es el parámetro de consulta para el término de búsqueda

    if (!q || q.trim().length < 2) {
        // No buscar si la consulta está vacía o es muy corta para evitar resultados irrelevantes
        return res.json({ communities: [], posts: [] });
    }

    console.log(`BACKEND (Search): Buscando el término: "${q}"`);

    try {
        // Usamos Promise.all para ejecutar ambas búsquedas en paralelo para mayor eficiencia
        const [communities, posts] = await Promise.all([
            // Búsqueda en el modelo Community
            prisma.community.findMany({
                where: {
                    OR: [
                        { name: { contains: q, mode: 'insensitive' } }, // Busca en el nombre
                        { description: { contains: q, mode: 'insensitive' } } // Busca en la descripción
                    ],
                    esPublica: true // Solo buscar en comunidades públicas
                },
                take: 5, // Limitar a los 5 mejores resultados para comunidades
                select: {
                    id: true,
                    name: true,
                }
            }),
            // Búsqueda en el modelo Post
            prisma.post.findMany({
                where: {
                    OR: [
                        { title: { contains: q, mode: 'insensitive' } }, // Busca en el título
                        { content: { contains: q, mode: 'insensitive' } } // Busca en el contenido
                    ],
                    community: {
                        esPublica: true // Solo buscar posts de comunidades públicas
                    }
                },
                take: 5, // Limitar a los 5 mejores resultados para posts
                select: {
                    id: true,
                    title: true,
                    community: { // Incluir la comunidad para mostrar el contexto en el frontend
                        select: {
                            name: true
                        }
                    }
                }
            })
        ]);

        console.log(`BACKEND (Search): Encontrados ${communities.length} comunidades y ${posts.length} posts.`);

        // Devolver el objeto con la estructura que el frontend espera
        res.json({ communities, posts });

    } catch (error) {
        console.error('❌ Error en el endpoint de búsqueda:', error);
        res.status(500).json({ error: 'Error al realizar la búsqueda.', detalle: error.message });
    }
});

module.exports = router;