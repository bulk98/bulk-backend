// routes/users.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');
const { body, param, validationResult } = require('express-validator');
const { ReactionType } = require('../constants/reactions');
const { UserType } = require('@prisma/client');

// --- NUEVO: Dependencias para subida de archivos ---
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');


// --- NUEVO: Configuración de Multer para Avatares ---
// Carpeta temporal para subidas (igual que en posts.routes.js, podría centralizarse)
const tempUploadDir = path.join(__dirname, '..', 'uploads_temp_bulk');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempUploadDir);
  },
  filename: function (req, file, cb) {
    const safeOriginalName = file.originalname.replace(/\s+/g, '_');
    cb(null, `avatar-${Date.now()}-${safeOriginalName}`); // Prefijo para diferenciar
  }
});

const avatarFileFilter = (req, file, cb) => {
  if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'image/gif' || file.mimetype === 'image/webp') {
    cb(null, true);
  } else {
    req.fileValidationError = 'Tipo de archivo no soportado para avatar. Solo imágenes (JPEG, PNG, GIF, WEBP) son permitidas.';
    cb(null, false);
  }
};

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 1024 * 1024 * 5 }, // Límite de 5MB para avatares (ajustable)
  fileFilter: avatarFileFilter
});
// --- FIN DE NUEVO: Configuración de Multer ---


// GET /api/me/profile -> Obtiene el perfil del usuario autenticado
router.get('/me/profile', authenticateToken, async (req, res) => {
    try {
        const userProfile = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                id: true, email: true, tipo_usuario: true, createdAt: true, avatarUrl: true,
                suscritoAComunidadesIds: true,
                name: true, username: true, bio: true, fechaDeNacimiento: true, paisDeNacimiento: true, ciudadDeNacimiento: true, domicilio: true, celular: true,
                _count: { select: { createdCommunities: true, memberships: true, posts: true, comments: true } }
              }
        });
        if (!userProfile) return res.status(404).json({ error: 'Perfil de usuario no encontrado.' });
        res.status(200).json(userProfile);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el perfil del usuario.', detalle: error.message });
    }
});

// PUT /api/me/profile -> Actualiza el perfil del usuario autenticado
router.put('/me/profile', authenticateToken,
    [
        body('email').optional().isEmail().withMessage('Email inválido.').normalizeEmail(),
        body('tipo_usuario').optional().isIn([UserType.OG, UserType.CREW]).withMessage(`Tipo de usuario debe ser '${UserType.OG}' o '${UserType.CREW}'.`),
        body('name').optional().isString().trim(),
        body('username').optional().isString().trim(),
        body('bio').optional({ checkFalsy: true }).isString().trim(),
        // ... otras validaciones ...
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        
        const userId = req.userId;
        const { email, tipo_usuario, name, username, bio, fechaDeNacimiento, paisDeNacimiento, ciudadDeNacimiento, domicilio, celular } = req.body;
  
        const dataToUpdate = {};
        if (email !== undefined) dataToUpdate.email = email;
        if (tipo_usuario !== undefined) dataToUpdate.tipo_usuario = tipo_usuario;
        if (name !== undefined) dataToUpdate.name = name;
        if (username !== undefined) dataToUpdate.username = username;
        if (bio !== undefined) dataToUpdate.bio = bio;
        if (fechaDeNacimiento !== undefined) dataToUpdate.fechaDeNacimiento = fechaDeNacimiento;
        if (paisDeNacimiento !== undefined) dataToUpdate.paisDeNacimiento = paisDeNacimiento;
        if (ciudadDeNacimiento !== undefined) dataToUpdate.ciudadDeNacimiento = ciudadDeNacimiento;
        if (domicilio !== undefined) dataToUpdate.domicilio = domicilio;
        if (celular !== undefined) dataToUpdate.celular = celular;
  
        if (Object.keys(dataToUpdate).length === 0) {
            return res.status(400).json({ error: 'Debes proporcionar al menos un dato para actualizar.' });
        }
  
        try {
            const usuarioActualizado = await prisma.user.update({
                where: { id: userId },
                data: dataToUpdate,
                select: { id: true, email: true, tipo_usuario: true, createdAt: true, avatarUrl: true, bio: true, name: true, username: true },
            });
            res.status(200).json({ mensaje: 'Perfil actualizado con éxito', perfil: usuarioActualizado });
        } catch (error) {
            if (error.code === 'P2002') {
                const field = error.meta?.target?.includes('email') ? 'email' : 'username';
                res.status(409).json({ error: `El ${field} proporcionado ya está en uso.` });
            } else {
                res.status(500).json({ error: 'Error al actualizar el perfil.', detalle: error.message });
            }
        }
    }
);

// Endpoint para Subir/Actualizar Avatar del Usuario ---
// PATCH /api/me/avatar
router.patch(
    '/me/avatar', // Ruta para la actualización específica del avatar
    authenticateToken,
    uploadAvatar.single('avatarImage'), // Middleware de Multer para un archivo 'avatarImage'
    async (req, res) => {
        const userId = req.userId;
        console.log(`>>> (users.routes.js) Usuario ID ${userId} intentando actualizar avatar.`);

        if (req.fileValidationError) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path); // Limpiar archivo temporal si existe
            }
            return res.status(400).json({ errors: [{ msg: req.fileValidationError, path: 'avatarImage', location: 'file' }] });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó ningún archivo de imagen para el avatar.' });
        }

        const tempFilePath = req.file.path;
        let cloudinaryResponse = null;

        try {
            // 1. Obtener el usuario actual para verificar si ya tiene un avatar
            const currentUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { avatarPublicId: true }
            });

            if (!currentUser) { // Aunque authenticateToken ya debería cubrir esto.
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }

            // 2. Si el usuario ya tiene un avatar, eliminar el antiguo de Cloudinary
            if (currentUser.avatarPublicId) {
                console.log(`>>> (users.routes.js) Eliminando avatar antiguo ${currentUser.avatarPublicId} de Cloudinary...`);
                try {
                    await deleteFromCloudinary(currentUser.avatarPublicId);
                    console.log(`>>> (users.routes.js) Avatar antiguo ${currentUser.avatarPublicId} eliminado de Cloudinary.`);
                } catch (deleteError) {
                    console.warn(`⚠️ (users.routes.js) Fallo al eliminar avatar antiguo ${currentUser.avatarPublicId} de Cloudinary:`, deleteError.message);
                    // No bloqueamos la subida del nuevo avatar por esto, pero es bueno loguearlo.
                }
            }

            // 3. Subir el nuevo avatar a Cloudinary
            console.log(`>>> (users.routes.js) Subiendo ${tempFilePath} a Cloudinary para avatar...`);
            cloudinaryResponse = await uploadToCloudinary(tempFilePath, "bulk_avatars"); // Carpeta específica para avatares
            console.log(`>>> (users.routes.js) Avatar subido a Cloudinary: ${cloudinaryResponse.url}`);

            // 4. Actualizar el usuario en la base de datos con la nueva URL y public_id del avatar
            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: {
                    avatarUrl: cloudinaryResponse.url,
                    avatarPublicId: cloudinaryResponse.public_id
                },
                select: { id: true, email: true, tipo_usuario: true, avatarUrl: true } // Devolver el perfil actualizado
            });

            res.status(200).json({
                mensaje: 'Avatar actualizado con éxito.',
                perfil: updatedUser
            });

        } catch (error) {
            console.error(`❌ (users.routes.js) Error en PATCH /me/avatar:`, error);
            // Si la subida a Cloudinary fue exitosa pero la actualización de DB falló, hacer rollback de Cloudinary
            if (cloudinaryResponse && error) {
                console.warn(`>>> (users.routes.js) Avatar ${cloudinaryResponse.public_id} subido a Cloudinary pero DB falló. Intentando eliminar de Cloudinary...`);
                try {
                    await deleteFromCloudinary(cloudinaryResponse.public_id);
                    console.log(`>>> (users.routes.js) Avatar ${cloudinaryResponse.public_id} eliminado de Cloudinary (rollback).`);
                } catch (rollbackError) {
                    console.error(`⚠️ (users.routes.js) Fallo al eliminar avatar ${cloudinaryResponse.public_id} de Cloudinary durante rollback:`, rollbackError);
                }
            }
            res.status(500).json({ error: 'Error interno al actualizar el avatar.', detalle: error.message });
        } finally {
            // 5. Limpiar el archivo temporal del servidor
            if (tempFilePath && fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log(`>>> (users.routes.js) Archivo temporal ${tempFilePath} eliminado.`);
            }
        }
    }
);

// Endpoint para Eliminar Avatar del Usuario ---
// DELETE /api/me/avatar (si este router está montado en /api)
router.delete(
    '/me/avatar',
    authenticateToken,
    async (req, res) => {
        const userId = req.userId;
        console.log(`>>> (users.routes.js) Usuario ID ${userId} intentando eliminar avatar.`);

        try {
            // 1. Obtener el usuario para verificar si tiene un avatar y su public_id
            const currentUser = await prisma.user.findUnique({
                where: { id: userId },
                select: { avatarUrl: true, avatarPublicId: true }
            });

            if (!currentUser) { // Redundante si authenticateToken funciona bien
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }

            if (!currentUser.avatarUrl || !currentUser.avatarPublicId) {
                return res.status(404).json({ error: 'No hay avatar para eliminar.' });
            }

            // 2. Eliminar el avatar de Cloudinary
            console.log(`>>> (users.routes.js) Eliminando avatar ${currentUser.avatarPublicId} de Cloudinary...`);
            await deleteFromCloudinary(currentUser.avatarPublicId);
            console.log(`>>> (users.routes.js) Avatar ${currentUser.avatarPublicId} eliminado de Cloudinary.`);
            
            // 3. Actualizar el usuario en la base de datos para quitar la referencia al avatar
            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: {
                    avatarUrl: null,
                    avatarPublicId: null
                },
                select: { id: true, email: true, tipo_usuario: true, avatarUrl: true } // Devolver perfil actualizado
            });

            res.status(200).json({
                mensaje: 'Avatar eliminado con éxito.',
                perfil: updatedUser
            });

        } catch (error) {
            console.error(`❌ (users.routes.js) Error en DELETE /me/avatar:`, error);
            // Podrías tener un caso donde Cloudinary falla pero igual quieres limpiar la DB, o viceversa.
            // Por ahora, un error en Cloudinary (ej. 'not found') se propagará y podría evitar la limpieza de la DB.
            // Esto es generalmente aceptable, ya que si no se puede confirmar la eliminación, es mejor no dejar la DB inconsistente.
             if (error.message?.includes("not found") || error.result?.includes("not found")) { // error.result es de cloudinary
                // Si Cloudinary dice 'not found', es posible que el public_id en la DB no coincida o ya fue borrado.
                // Procedemos a limpiar la DB igualmente.
                console.warn(`>>> (users.routes.js) Avatar no encontrado en Cloudinary (public_id: ${currentUser?.avatarPublicId}), limpiando DB igualmente.`);
                try {
                    const userAfterCloudinaryNotFound = await prisma.user.update({
                        where: { id: userId }, data: { avatarUrl: null, avatarPublicId: null },
                        select: { id: true, email: true, tipo_usuario: true, avatarUrl: true }
                    });
                     return res.status(200).json({ mensaje: 'Avatar no encontrado en el proveedor de almacenamiento, pero la referencia fue eliminada del perfil.', perfil: userAfterCloudinaryNotFound });
                } catch (dbError) {
                     console.error(`❌ (users.routes.js) Error limpiando DB después de Cloudinary 'not found':`, dbError);
                     return res.status(500).json({ error: 'Error al eliminar la referencia del avatar del perfil después de un problema con el proveedor de almacenamiento.', detalle: dbError.message });
                }
            }
            res.status(500).json({ error: 'Error interno al eliminar el avatar.', detalle: error.message });
        }
    }
);


// --- Endpoint para el Feed Personalizado del Usuario (CORREGIDO) ---
router.get(
    '/me/feed', 
    authenticateToken, 
    async (req, res) => {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    try {
        console.log(`[Feed Debug] 1. Iniciando feed para usuario: ${userId}`);

        const userWithContext = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                memberships: { select: { communityId: true } },
                suscritoAComunidadesIds: true,
                createdCommunities: { select: { id: true } }
            }
        });

        if (!userWithContext) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        
        console.log('[Feed Debug] 2. Contexto de usuario obtenido.');

        const memberCommunityIds = userWithContext.memberships?.map(m => m.communityId) ?? [];
        if (memberCommunityIds.length === 0) {
            console.log('[Feed Debug] Usuario no es miembro de ninguna comunidad. Devolviendo feed vacío.');
            return res.status(200).json({ posts: [], currentPage: page, totalPages: 0, totalPostsInFeed: 0 });
        }
        
        const subscribedCommunityIds = userWithContext.suscritoAComunidadesIds ?? [];
        const userCreatedCommunityIds = userWithContext.createdCommunities?.map(c => c.id) ?? [];

        const whereCondition = {
            AND: [
                { communityId: { in: memberCommunityIds } },
                { OR: [
                    { esPremium: false },
                    { AND: [{ esPremium: true }, { communityId: { in: subscribedCommunityIds } }] },
                    { AND: [{ esPremium: true }, { communityId: { in: userCreatedCommunityIds } }] }
                ]}
            ]
        };
        
        console.log('[Feed Debug] 3. Condición de búsqueda construida. Ejecutando consulta de posts...');

        const postsFromDb = await prisma.post.findMany({
            where: whereCondition,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
            select: {
                id: true, title: true, content: true, esPremium: true, createdAt: true, updatedAt: true, imageUrl: true,
                author: { select: { id: true, email: true, name: true, username: true, avatarUrl: true, name: true, username: true } },
                community: { select: { id: true, name: true, logoUrl: true } },
                _count: { select: { comments: true, reactions: true } },
                // NUEVO: Incluimos las reacciones del usuario actual para saber si dio like
                reactions: {
                      where: { userId: userId }, // Filtra por el usuario actual
                      select: { id: true }
                }
            }
        });
        
        console.log(`[Feed Debug] 4. Consulta de posts finalizada. Se encontraron ${postsFromDb.length} posts.`);

        // NUEVO: Procesamos los posts para añadir la propiedad 'userHasLiked'
        const posts = postsFromDb.map(post => {
            const { reactions, ...restOfPost } = post;
            return {
                ...restOfPost,
                userHasLiked: reactions.length > 0
            };
        });

        const totalPosts = await prisma.post.count({ where: whereCondition });
        const totalPages = Math.ceil(totalPosts / limit);
        
        console.log('[Feed Debug] 5. Conteo total finalizado. Enviando respuesta al frontend.');

        res.json({ posts, currentPage: page, totalPages, totalPostsInFeed: totalPosts });

    } catch (error) {
        console.error(`❌ Error en GET /me/feed para el usuario ID ${userId}:`, error);
        res.status(500).json({ error: 'Error al obtener el feed personalizado.', detalle: error.message });
    }
});
  
// --- Endpoint para Datos del Panel de Control del GURU ---
router.get('/me/dashboard', authenticateToken, async (req, res) => {
    const userId = req.userId;
    console.log(`BACKEND (Dashboard): Petición a GET /me/dashboard para el usuario ID: ${userId}`);
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { tipo_usuario: true }
        });
  
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        if (user.tipo_usuario !== UserType.OG) {
            return res.status(403).json({ error: 'Acceso denegado. Funcionalidad solo para GURUS.' });
        }
  
        // 1. Obtener las comunidades gestionadas por el GURÚ
        const managedCommunitiesFromDB = await prisma.community.findMany({
            where: { createdById: userId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                description: true, // Útil para el frontend si se quiere mostrar
                esPublica: true,   // Útil para el frontend
                createdAt: true,   // Útil para el frontend
                logoUrl: true,
                bannerUrl: true,
                _count: {
                    select: { 
                        memberships: true, // Total de miembros (seguidores + suscriptores si se maneja así)
                        posts: true       // Total de posts en la comunidad
                    }
                }
                // No seleccionamos 'posts' aquí para evitar cargar todos los posts,
                // calcularemos los likes y comentarios de los posts agregados.
            }
        });
  
        // 2. Para cada comunidad, calcular los likes totales, comentarios totales y suscriptores premium
        const augmentedCommunities = await Promise.all(
            managedCommunitiesFromDB.map(async (community) => {
                // Contar todos los "LIKE" en todos los posts de esta comunidad
                const totalLikesInCommunity = await prisma.reaction.count({
                    where: {
                        post: {
                            communityId: community.id
                        },
                        type: ReactionType.LIKE // O el string "LIKE" si no usas enum
                    }
                });

                // Contar todos los comentarios en todos los posts de esta comunidad
                const totalCommentsInCommunity = await prisma.comment.count({
                    where: {
                        post: {
                            communityId: community.id
                        }
                    }
                });

                // Contar cuántos usuarios están suscritos a esta comunidad específica
                const totalPremiumSubscribers = await prisma.user.count({
                    where: {
                        suscritoAComunidadesIds: {
                            has: community.id // Prisma filter para arrays que contienen un elemento
                        }
                    }
                });

                return {
                    ...community, // Todos los campos originales de la comunidad
                    memberCount: community._count.memberships, // Renombrar para claridad si quieres
                    postCount: community._count.posts,       // Renombrar para claridad si quieres
                    totalLikes: totalLikesInCommunity,
                    totalComments: totalCommentsInCommunity,
                    premiumSubscribersCount: totalPremiumSubscribers
                };
            })
        );
  
        res.status(200).json({
            totalCommunitiesCreated: managedCommunitiesFromDB.length,
            managedCommunities: augmentedCommunities // Enviar las comunidades con los datos aumentados
        });

    } catch (error) {
        console.error(`❌ BACKEND (Dashboard): Error en GET /me/dashboard para Usuario ID ${userId}:`, error);
        res.status(500).json({ error: 'Error al obtener los datos del panel de control.', detalle: error.message });
    }
});


/**
 * @route   GET /api/users/:userId/profile
 * @desc    Obtener el perfil público de un usuario por su ID
 * @access  Público
 */
router.get(
    '/users/:userId/profile',
    [
        param('userId').isMongoId().withMessage('El ID de usuario proporcionado no es válido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { userId } = req.params;

        try {
            const userProfile = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    name: true,
                    username: true,
                    bio: true,
                    avatarUrl: true,
                    tipo_usuario: true,
                    createdAt: true,
                    _count: {
                        select: {
                            createdCommunities: true,
                            memberships: true,
                            posts: true
                        }
                    }
                }
            });

            if (!userProfile) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }

            res.status(200).json(userProfile);

        } catch (error) {
            console.error(`Error en GET /api/users/${userId}/profile:`, error);
            res.status(500).json({ error: 'Error al obtener el perfil público del usuario.', detalle: error.message });
        }
    }
);

/**
 * @route   GET /api/users/:userId/posts
 * @desc    Obtener los posts creados por un usuario (paginado)
 * @access  Público
 */
router.get(
    '/users/:userId/posts',
    [
        param('userId').isMongoId().withMessage('El ID de usuario proporcionado no es válido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        try {
            // Verificar si el usuario existe
            const userExists = await prisma.user.count({ where: { id: userId } });
            if (userExists === 0) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }

            const posts = await prisma.post.findMany({
                where: { authorId: userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true, title: true, content: true, esPremium: true, createdAt: true, imageUrl: true,
                    author: { select: { id: true, name: true, username: true, avatarUrl: true } },
                    community: { select: { id: true, name: true, logoUrl: true } },
                    _count: { select: { comments: true, reactions: true } }
                }
            });

            const totalPosts = await prisma.post.count({ where: { authorId: userId } });
            const totalPages = Math.ceil(totalPosts / limit);

            res.status(200).json({
                posts,
                currentPage: page,
                totalPages,
                totalPosts
            });

        } catch (error) {
            console.error(`Error en GET /api/users/${userId}/posts:`, error);
            res.status(500).json({ error: 'Error al obtener los posts del usuario.', detalle: error.message });
        }
    }
);

/**
 * @route   GET /api/users/:userId/communities
 * @desc    Obtener las comunidades a las que pertenece un usuario
 * @access  Público
 */
router.get(
    '/users/:userId/communities',
    [
        param('userId').isMongoId().withMessage('El ID de usuario proporcionado no es válido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { userId } = req.params;

        try {
            // Verificar si el usuario existe
            const userExists = await prisma.user.count({ where: { id: userId } });
            if (userExists === 0) {
                return res.status(404).json({ message: 'Usuario no encontrado.' });
            }

            const memberships = await prisma.communityMembership.findMany({
                where: { userId: userId },
                select: {
                    community: {
                        select: {
                            id: true,
                            name: true,
                            logoUrl: true,
                            bannerUrl: true,
                            _count: {
                                select: {
                                    memberships: true
                                }
                            }
                        }
                    }
                }
            });

            const communities = memberships.map(m => m.community);

            res.status(200).json(communities);

        } catch (error) {
            console.error(`Error en GET /api/users/${userId}/communities:`, error);
            res.status(500).json({ error: 'Error al obtener las comunidades del usuario.', detalle: error.message });
        }
    }
);

module.exports = router;