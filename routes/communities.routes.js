// routes/communities.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticateToken } = require('../middleware/auth.middleware');
const { param, body, validationResult } = require('express-validator');
const { RoleInCommunity } = require('@prisma/client'); // Para usar el Enum

// --- NUEVO: Dependencias para subida de archivos ---
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');

// --- NUEVO: Configuración de Multer (similar a users.routes.js y posts.routes.js) ---
const tempUploadDir = path.join(__dirname, '..', 'uploads_temp_bulk');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Configuración para Logos de Comunidad
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadDir),
  filename: (req, file, cb) => {
    const safeOriginalName = file.originalname.replace(/\s+/g, '_');
    cb(null, `commLogo-${Date.now()}-${safeOriginalName}`);
  }
});

const imageFileFilter = (req, file, cb) => { // Filtro genérico para imágenes
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    req.fileValidationError = 'Tipo de archivo no soportado. Solo imágenes son permitidas.';
    cb(null, false);
  }
};

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 1024 * 1024 * 2 }, // Límite de 2MB para logos
  fileFilter: imageFileFilter
});

// Configuración para Banners de Comunidad
const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadDir),
  filename: (req, file, cb) => {
    const safeOriginalName = file.originalname.replace(/\s+/g, '_');
    cb(null, `commBanner-${Date.now()}-${safeOriginalName}`);
  }
});

const uploadBanner = multer({
  storage: bannerStorage,
  limits: { fileSize: 1024 * 1024 * 8 }, // Límite de 8MB para banners
  fileFilter: imageFileFilter
});
// --- FIN DE NUEVO: Configuración de Multer ---

// --- Endpoint para Listar Comunidades Públicas (GET /api/communities/) ---
// Muestra todas las comunidades marcadas como públicas, con paginación.
router.get('/', async (req, res) => {
    console.log('¡Petición al endpoint /api/communities (listar públicas) recibida!');
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20; // Puedes ajustar el límite por defecto
        const skip = (page - 1) * limit;

        const comunidadesPublicas = await prisma.community.findMany({
            where: { esPublica: true },
            orderBy: { createdAt: 'desc' },
            skip: skip,
            take: limit,
            select: {
                id: true, name: true, description: true, esPublica: true, createdAt: true, logoUrl: true, bannerUrl: true,
                createdBy: { select: { id: true, email: true, avatarUrl: true  } }, // Considerar si el email del creador debe ser público
                _count: { select: { memberships: true, posts: true } }
            }
        });

        const totalComunidadesPublicas = await prisma.community.count({ where: { esPublica: true } });
        const totalPages = Math.ceil(totalComunidadesPublicas / limit);

        console.log(`✅ Encontradas ${comunidadesPublicas.length} de ${totalComunidadesPublicas} comunidades públicas (Página <span class="math-inline">\{page\}/</span>{totalPages}).`);
        res.status(200).json({
            mensaje: "Lista de comunidades públicas obtenida.",
            comunidades: comunidadesPublicas,
            currentPage: page,
            totalPages: totalPages,
            totalComunidades: totalComunidadesPublicas
        });
    } catch (error) {
        console.error('❌ Error en el endpoint /api/communities (listar públicas):', error);
        res.status(500).json({ error: 'Error al obtener la lista de comunidades públicas.', detalle: error.message });
    }
});

// --- Endpoint para Crear Comunidades (ACTUALIZADO CON IDIOMAS) ---
router.post(
    '/',
    authenticateToken,
    [
      body('name').trim().notEmpty().withMessage('El nombre es obligatorio.'),
      body('esPublica').isBoolean(),
      body('categoria').trim().notEmpty(),
      // === INICIO DE LA MODIFICACIÓN ===
      body('idiomaPrincipal').trim().notEmpty().withMessage('El idioma principal es obligatorio.'),
      body('idiomaSecundario').optional({ checkFalsy: true }).trim()
      // === FIN DE LA MODIFICACIÓN ===
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        // === INICIO DE LA MODIFICACIÓN ===
        const { name, description, esPublica, categoria, idiomaPrincipal, idiomaSecundario } = req.body;
        // === FIN DE LA MODIFICACIÓN ===
        const creatorId = req.userId;
  
        try {
            const nuevaComunidad = await prisma.community.create({
                data: {
                    name,
                    description,
                    esPublica, 
                    categoria,
                    // === INICIO DE LA MODIFICACIÓN ===
                    idiomaPrincipal,
                    idiomaSecundario, // Si es un string vacío, Prisma lo guardará como tal. El frontend envía null si es necesario.
                    // === FIN DE LA MODIFICACIÓN ===
                    createdBy: { connect: { id: creatorId } },
                    memberships: {
                        create: {
                            userId: creatorId,
                            role: 'CREATOR'
                        }
                    },
                },
                select: { id: true, name: true }
            });
  
            res.status(201).json({
                mensaje: 'Comunidad creada con éxito',
                comunidad: nuevaComunidad
            });
  
        } catch (error) {
            if (error.code === 'P2002') {
                res.status(409).json({ error: 'Ya existe una comunidad con este nombre.' });
            } else {
                res.status(500).json({ error: 'Error al crear la comunidad.', detalle: error.message });
            }
        }
    }
);
  
// --- Endpoint para Ver los Detalles de una Comunidad Específica (ACTUALIZADO) ---
router.get(
    '/:communityId',
    authenticateToken,
    [ param('communityId').isMongoId().withMessage('ID de comunidad inválido.') ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const communityId = req.params.communityId;
        const userId = req.userId;
        
        try {
            const comunidad = await prisma.community.findUnique({
                where: { id: communityId },
                select: {
                    id: true, name: true, description: true, esPublica: true, createdAt: true,
                    idiomaPrincipal: true, idiomaSecundario: true,
                    createdById: true, logoUrl: true, bannerUrl: true,
                    createdBy: { select: { id: true, name: true, username: true, avatarUrl: true } },
                    _count: { select: { posts: true, memberships: true } },
                }
            });
            
            if (!comunidad) {
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }
 
            let respuestaComunidad = { ...comunidad };
            let currentUserMembershipData = { isMember: false, isSubscribed: false };

            if (userId) {
                // Hacemos una sola consulta para obtener la membresía y el estado de suscripción del usuario
                const userContext = await prisma.user.findUnique({
                    where: { id: userId },
                    select: {
                        suscritoAComunidadesIds: true,
                        memberships: {
                            where: { communityId: communityId },
                            select: { role: true, canPublishPremiumContent: true }
                        }
                    }
                });

                if (userContext) {
                    // Verificamos si es miembro
                    if (userContext.memberships && userContext.memberships.length > 0) {
                        currentUserMembershipData.isMember = true;
                        currentUserMembershipData.role = userContext.memberships[0].role;
                        currentUserMembershipData.canPublishPremiumContent = userContext.memberships[0].canPublishPremiumContent;
                    }
                    // Verificamos si está suscrito
                    if (userContext.suscritoAComunidadesIds.includes(communityId)) {
                        currentUserMembershipData.isSubscribed = true;
                    }
                }
            }
            
            respuestaComunidad.currentUserMembership = currentUserMembershipData;
            
            // Lógica de permisos para comunidades privadas
            if (!comunidad.esPublica && !respuestaComunidad.currentUserMembership.isMember) {
                 return res.status(403).json({ error: 'Acceso denegado. Esta comunidad es privada.' });
            }
 
            res.status(200).json(respuestaComunidad);

        } catch (error) {
            console.error(`Error en GET /api/communities/${communityId}:`, error);
            res.status(500).json({ error: 'Error al obtener los detalles de la comunidad.', detalle: error.message });
        }
    }
);

// --- Endpoint para Actualizar una Comunidad (PUT /api/communities/:communityId) ---
// Permite al creador de una comunidad actualizar su nombre, descripción o estado público/privado.
router.put(
    '/:communityId', // La ruta ahora usa :communityId
    authenticateToken,
    [
      param('communityId').isMongoId().withMessage('El ID de la comunidad proporcionado en la URL no es válido.'),
      body('name').optional().trim().notEmpty().withMessage('El nombre no puede estar vacío si se proporciona.'),
      // Para description, permitir que sea una cadena vacía para "limpiar" la descripción si se desea
      body('description').optional({ checkFalsy: false }).isString().trim(),
      body('esPublica').optional().isBoolean().withMessage('El campo esPublica debe ser true o false.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
  
        const communityId = req.params.communityId; // Cambiado de req.params.id
        const userId = req.userId; // ID del usuario que realiza la petición (debe ser el creador)
        const { name, description, esPublica } = req.body;
  
        // Verificar que al menos un campo se esté intentando actualizar
        if (name === undefined && description === undefined && esPublica === undefined) {
            return res.status(400).json({ error: 'Se deben proporcionar datos para actualizar (name, description o esPublica).' });
        }
  
        try {
            // 1. Verificar que la comunidad exista y que el usuario sea el creador
            const comunidadExistente = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true } // Solo necesitamos el ID del creador para verificar el permiso
            });
  
            if (!comunidadExistente) {
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }
  
            if (comunidadExistente.createdById !== userId) {
                // Solo el creador puede actualizar la comunidad
                return res.status(403).json({ error: 'No tienes permiso para actualizar esta comunidad.' });
            }
  
            // 2. Construir el objeto con los datos a actualizar
            const dataToUpdate = {};
            if (name !== undefined) { dataToUpdate.name = name; }
            // Permitir explícitamente que description sea una cadena vacía
            if (description !== undefined) { dataToUpdate.description = description; }
            if (esPublica !== undefined) { dataToUpdate.esPublica = esPublica; }
  
            // 3. Realizar la actualización
            const comunidadActualizada = await prisma.community.update({
                where: { id: communityId },
                data: dataToUpdate,
                select: { // Seleccionar los campos que se devolverán en la respuesta
                    id: true, name: true, description: true, esPublica: true, createdAt: true,
                    createdBy: { select: { id: true, email: true } }, // Info del creador
                }
            });
  
            res.status(200).json({
                mensaje: 'Comunidad actualizada con éxito',
                comunidad: comunidadActualizada
            });
  
        } catch (error) {
            console.error(`❌ Error en PUT /api/communities/${communityId} (actualizar):`, error);
            if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
                 res.status(409).json({ error: 'Ya existe otra comunidad con el nombre proporcionado.', detalle: error.message });
            } else if (error.code === 'P2025') {
                 // Este error ("Record to update not found") ya está cubierto por la verificación !comunidadExistente
                 res.status(404).json({ error: 'Comunidad no encontrada para actualizar.', detalle: error.message });
            } else {
                res.status(500).json({ error: 'Error al actualizar la comunidad.', detalle: error.message });
            }
        }
    }
  );

  // --- Endpoint para Eliminar una Comunidad (DELETE /api/communities/:communityId) ---
// Permite al creador de una comunidad eliminarla completamente.
router.delete(
    '/:communityId', // La ruta ahora usa :communityId
    authenticateToken,
    [ // Validación del parámetro de ruta
        param('communityId').isMongoId().withMessage('El ID de la comunidad proporcionado no es válido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
  
        const communityId = req.params.communityId; // Cambiado de req.params.id
        const userId = req.userId; // ID del usuario que realiza la petición (debe ser el creador)
  
        console.log(`>>> Usuario ID ${userId} intentando eliminar Comunidad ID ${communityId}`);
  
        try {
            // 1. Verificar que la comunidad exista y que el usuario sea el creador
            const comunidadExistente = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true } // Solo necesitamos el ID del creador para verificar el permiso
            });
  
            if (!comunidadExistente) {
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }
  
            if (comunidadExistente.createdById !== userId) {
                // Solo el creador puede eliminar la comunidad
                return res.status(403).json({ error: 'No tienes permiso para eliminar esta comunidad.' });
            }
  
            // IMPORTANTE: Lógica de eliminación en cascada
            // Antes de eliminar la comunidad, necesitas eliminar todas las dependencias:
            // 1. Comentarios de los posts de esa comunidad (si no se eliminan con los posts)
            // 2. Posts de esa comunidad
            // 3. Membresías (CommunityMembership) de esa comunidad
            // 4. Suscripciones relacionadas (si el array suscritoAComunidadesIds en User debe limpiarse) - Esto es más complejo.
  
            // Por ahora, replicamos la lógica simple, pero esto DEBE mejorarse.
            // Una forma de hacerlo es con transacciones interactivas o múltiples awaits.
  
            // Ejemplo de cómo podrías empezar a manejarlo (esto es simplificado):
            // await prisma.comment.deleteMany({ where: { post: { communityId: communityId } } }); // Si los comentarios no se borran en cascada con los posts
            await prisma.post.deleteMany({ where: { communityId: communityId } });
            await prisma.communityMembership.deleteMany({ where: { communityId: communityId } });
            // Considerar también limpiar `suscritoAComunidadesIds` en los usuarios, aunque esto es más complejo.
  
  
            // 4. Realizar la eliminación de la comunidad
            const comunidadEliminada = await prisma.community.delete({
                where: { id: communityId },
                select: { id: true, name: true } // Devolver info de la comunidad eliminada
            });
  
            console.log(`✅ Comunidad con ID ${communityId} y sus posts/membresías asociados eliminados (lógica simplificada).`);
            res.status(200).json({
                mensaje: 'Comunidad y contenido asociado eliminados con éxito (lógica simplificada).',
                comunidad: comunidadEliminada
            });
  
        } catch (error) {
            console.error(`❌ Error en DELETE /api/communities/${communityId} (eliminar):`, error);
            if (error.code === 'P2025') { // "Record to delete not found"
                 res.status(404).json({ error: 'Comunidad no encontrada para eliminar.', detalle: error.message });
            } else {
                // Un error común aquí podría ser P2014 (violación de constraint) si intentas eliminar
                // una comunidad que todavía tiene posts o membresías y no has configurado onDelete: Cascade
                // o no los has eliminado manualmente antes.
                console.error("Detalle del error de Prisma:", error); // Loguear el error completo de Prisma
                res.status(500).json({ error: 'Error al eliminar la comunidad.', detalle: error.message, code: error.code });
            }
        }
    }
  );

// --- Endpoint para Unirse a una Comunidad (Refactorizado con CommunityMembership) ---
// POST /api/communities/:id/members (el usuario autenticado se une)
router.post(
    '/:communityId/members', // :communityId es el ID de la comunidad a la que unirse
    authenticateToken,
    [
        param('communityId')
            .isMongoId().withMessage('El ID de la comunidad no es válido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const communityId = req.params.communityId;
        const userId = req.userId; // ID del usuario que se une

        console.log(`>>> Usuario ID ${userId} intentando unirse a Comunidad ID ${communityId}`);

        try {
            // 1. Verificar que la comunidad existe
            const comunidad = await prisma.community.findUnique({
                where: { id: communityId },
                select: { id: true, createdById: true } // Necesitamos createdById para no permitir que el creador "se una" como miembro regular
            });

            if (!comunidad) {
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }

            // 2. Verificar si el usuario ya es miembro (o creador)
            const existingMembership = await prisma.communityMembership.findUnique({
                where: {
                    userId_communityId: { // Usar el índice único combinado
                        userId: userId,
                        communityId: communityId
                    }
                }
            });

            if (existingMembership) {
                console.log(`>>> Usuario ID ${userId} ya es miembro (Rol: ${existingMembership.role}) de Comunidad ID ${communityId}.`);
                return res.status(409).json({ mensaje: 'Ya eres miembro de esta comunidad.', rol: existingMembership.role }); // 409 Conflict
            }
            
            // 3. Crear la membresía con rol 'MEMBER'
            // No permitir que el creador se una de nuevo como 'MEMBER' si ya tiene rol 'CREATOR'
            // (La creación de comunidad ya asigna el rol CREATOR)
            if (comunidad.createdById === userId) {
                 console.log(`>>> Usuario ID ${userId} es el creador de Comunidad ID ${communityId} y ya tiene membresía como CREATOR.`);
                 return res.status(409).json({ mensaje: 'Ya eres el creador de esta comunidad.'});
            }


            const nuevaMembresia = await prisma.communityMembership.create({
                data: {
                    userId: userId,
                    communityId: communityId,
                    role: RoleInCommunity.MEMBER // Por defecto al unirse es Miembro
                },
                select: { // Devolver información útil
                    role: true,
                    assignedAt: true,
                    community: { select: { id: true, name: true } },
                    user: { select: { id: true, email: true } }
                }
            });

            console.log(`✅ Usuario ID ${userId} se unió a Comunidad ID ${communityId} como ${nuevaMembresia.role}.`);
            res.status(201).json({
                mensaje: 'Te has unido a la comunidad con éxito.',
                membresia: nuevaMembresia
            });

        } catch (error) {
            console.error(`❌ Error en POST /comunidades/${communityId}/members (unirse):`, error);
             if (error.code === 'P2002') { // Podría ocurrir si el unique constraint userId_communityId falla (ya cubierto arriba)
                return res.status(409).json({ error: 'Ya eres miembro de esta comunidad (conflicto de base de datos).', detalle: error.message });
            } else if (error.code === 'P2025') {
                return res.status(404).json({ error: 'Comunidad o Usuario no encontrado.', detalle: error.message });
            }
            res.status(500).json({ error: 'Error al unirse a la comunidad.', detalle: error.message });
        }
    }
);

// --- Endpoint para Salir de una Comunidad (DELETE /api/communities/:communityId/members) ---
// Permite a un usuario autenticado (que es miembro, pero no el creador) salir de una comunidad.
router.delete(
    '/:communityId/members', // La ruta usa el ID de la comunidad
    authenticateToken,       // Middleware: Asegura que el usuario esté logueado
    [
        // Validación: Asegura que el communityId en la URL sea un ID de MongoDB válido
        param('communityId')
            .isMongoId().withMessage('El ID de la comunidad no es válido.')
    ],
    async (req, res) => {
        // Comprueba si hubo errores de validación en los parámetros de la URL
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Si hay errores, devuelve una respuesta 400 (Solicitud incorrecta) con los errores
            return res.status(400).json({ errors: errors.array() });
        }

        const communityId = req.params.communityId; // Obtiene el ID de la comunidad desde la URL
        const userId = req.userId;                  // Obtiene el ID del usuario desde el token (puesto por authenticateToken)

        console.log(`>>> Usuario ID ${userId} intentando salir de Comunidad ID ${communityId}`);

        try {
            // 1. (Opcional, pero bueno para un error claro) Verificar que la comunidad exista
            const comunidadExistente = await prisma.community.findUnique({
                where: { id: communityId },
                select: { id: true } // Solo necesitamos saber si existe
            });

            if (!comunidadExistente) {
                // Si la comunidad no existe, devuelve 404 (No encontrado)
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }

            // 2. Buscar la membresía del usuario en esa comunidad específica
            const membership = await prisma.communityMembership.findUnique({
                where: {
                    // Se usa el índice único combinado de userId y communityId para buscar la membresía
                    userId_communityId: {
                        userId: userId,
                        communityId: communityId
                    }
                },
                select: {
                    id: true,   // Necesitamos el ID de la membresía para poder eliminarla
                    role: true  // Necesitamos el rol para la lógica del creador
                }
            });

            // 3. Si no se encuentra una membresía, el usuario no es miembro
            if (!membership) {
                console.log(`>>> Usuario ID ${userId} no es miembro de Comunidad ID ${communityId}, no puede salir.`);
                // Devuelve 404 indicando que no es miembro (o la membresía no existe)
                return res.status(404).json({ error: 'No eres miembro de esta comunidad.' });
            }

            // 4. Regla de Negocio: El CREADOR de la comunidad no puede "salir" usando este endpoint
            if (membership.role === RoleInCommunity.CREATOR) {
                console.log(`>>> Usuario ID ${userId} es CREATOR de Comunidad ID ${communityId}. No puede salir usando este endpoint.`);
                // Devuelve 403 (Prohibido) si el creador intenta salir
                return res.status(403).json({ error: 'Como creador de la comunidad, no puedes simplemente salir. Considera eliminar la comunidad o transferir propiedad (funcionalidad futura).' });
            }

            // 5. Si es un miembro normal (MEMBER o MODERATOR en el futuro), eliminar la membresía
            await prisma.communityMembership.delete({
                where: {
                    id: membership.id // Usa el ID de la membresía específica para eliminarla
                }
            });

            console.log(`✅ Usuario ID ${userId} ha salido de la Comunidad ID ${communityId}.`);
            // Devuelve 200 (OK) con un mensaje de éxito
            res.status(200).json({ mensaje: 'Has salido de la comunidad exitosamente.' });

        } catch (error) {
            // Si ocurre cualquier otro error durante el proceso
            console.error(`❌ Error en DELETE /api/communities/${communityId}/members (salir):`, error);
            // Manejo específico para error de Prisma P2025 (Registro a eliminar no existe)
            if (error.code === 'P2025') {
                 return res.status(404).json({ error: 'Membresía no encontrada para eliminar o ya fue eliminada.', detalle: error.message });
            }
            // Para cualquier otro error, devuelve un 500 (Error Interno del Servidor)
            res.status(500).json({ error: 'Error al intentar salir de la comunidad.', detalle: error.message });
        }
    }
);

// --- Endpoint para Listar Miembros de una Comunidad (GET /api/communities/:communityId/members) ---
// Muestra los miembros de una comunidad, con su rol.
// Controla el acceso si la comunidad es privada.
router.get(
    '/:communityId/members',    // La ruta usa el ID de la comunidad
    authenticateToken,          // Middleware: Asegura que el usuario esté logueado
    [
        // Validación: Asegura que el communityId en la URL sea un ID de MongoDB válido
        param('communityId')
            .isMongoId().withMessage('El ID de la comunidad no es válido.')
    ],
    async (req, res) => {
        // Comprueba si hubo errores de validación en los parámetros de la URL
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const communityId = req.params.communityId; // Obtiene el ID de la comunidad desde la URL
        const requestingUserId = req.userId;        // ID del usuario que hace la petición

        console.log(`>>> Usuario ID ${requestingUserId} solicitando lista de miembros para Comunidad ID ${communityId}`);

        try {
            // 1. Verificar que la comunidad exista y obtener su privacidad y creador
            const comunidad = await prisma.community.findUnique({
                where: { id: communityId },
                select: { // Seleccionamos solo los campos necesarios para la lógica de permisos
                    id: true,
                    esPublica: true,
                    createdById: true // ID del creador de la comunidad
                }
            });

            if (!comunidad) {
                // Si la comunidad no existe, devuelve 404 (No encontrado)
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }

            // 2. Lógica de Permisos: Verificar si el usuario solicitante puede ver la lista de miembros
            let canViewMembers = comunidad.esPublica; // Si la comunidad es pública, cualquiera autenticado puede ver

            if (!comunidad.esPublica) { // Si es privada, se necesita ser miembro o creador
                if (comunidad.createdById === requestingUserId) { // El creador siempre puede ver
                    canViewMembers = true;
                } else {
                    // Verificar si el usuario solicitante es miembro de esta comunidad
                    const membership = await prisma.communityMembership.findUnique({
                        where: {
                            userId_communityId: {
                                userId: requestingUserId,
                                communityId: communityId
                            }
                        },
                        select: { id: true } // Solo necesitamos saber si existe la membresía
                    });
                    if (membership) { // Si se encontró una membresía, es miembro
                        canViewMembers = true;
                    }
                }
            }

            if (!canViewMembers) {
                console.log(`>>> ACCESO DENEGADO: Usuario ${requestingUserId} intentó listar miembros de Comunidad privada ${communityId} sin permiso.`);
                // Devolvemos 404 para no revelar la existencia de la comunidad a quien no debe saberlo.
                return res.status(404).json({ error: 'Comunidad no encontrada o acceso denegado.' });
            }

            // 3. Obtener todas las membresías de la comunidad, incluyendo la información del usuario y su rol
            const memberships = await prisma.communityMembership.findMany({
                where: { communityId: communityId }, // Filtra por el ID de la comunidad
                select: {
                    role: true,         // El rol del miembro en esta comunidad
                    assignedAt: true,   // Cuándo se unió
                    canPublishPremiumContent: true,
                    user: {             // Incluye información del modelo User asociado
                        select: {
                            id: true,
                            email: true,
                            tipo_usuario: true // El tipo de usuario global (Miembro o GURU)
                            
                            // Puedes añadir más campos del usuario si los necesitas, ej: nombre
                        }
                    }
                },
                orderBy: { // Opcional: Ordenar la lista (ej. por fecha de unión)
                    assignedAt: 'asc'
                }
            });
            
            // Transforma la lista de membresías para una respuesta más clara
            const memberList = memberships.map(m => ({
                userId: m.user.id,
                email: m.user.email,
                tipoUsuarioGlobal: m.user.tipo_usuario,
                roleInCommunity: m.role,
                canPublishPremiumContent: m.canPublishPremiumContent,
                joinedAt: m.assignedAt
            }));

            console.log(`✅ Lista de ${memberList.length} miembros devuelta para Comunidad ID ${communityId}.`);
            // Devuelve 200 (OK) con la lista de miembros
            res.status(200).json(memberList);

        } catch (error) {
            // Si ocurre cualquier otro error
            console.error(`❌ Error en GET /api/communities/${communityId}/members (listar):`, error);
            if (error.code === 'P2023' && error.message?.includes("Malformed ObjectID")) {
                 return res.status(400).json({ message: 'El ID de la comunidad proporcionado no es válido.' });
            }
            res.status(500).json({ error: 'Error al obtener la lista de miembros.', detalle: error.message });
        }
    }
);

// --- Endpoint para Asignar/Actualizar Rol de un Miembro en una Comunidad ---
// Ruta: PATCH /api/communities/:communityId/members/:memberUserId/role
router.patch(
    '/:communityId/members/:memberUserId/role',
    authenticateToken,
    [
      param('communityId').isMongoId().withMessage('ID de comunidad inválido.'),
      param('memberUserId').isMongoId().withMessage('ID de usuario miembro inválido.'),
      body('role').isIn([RoleInCommunity.MODERATOR, RoleInCommunity.MEMBER]) // Solo permite cambiar a MODERATOR o MEMBER
                   .withMessage(`El rol debe ser '${RoleInCommunity.MODERATOR}' o '${RoleInCommunity.MEMBER}'.`)
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
  
      const { communityId, memberUserId } = req.params;
      const requestingUserId = req.userId; // Usuario que hace la petición (debe ser el creador)
      const { role: newRole } = req.body;   // Nuevo rol a asignar (MODERATOR o MEMBER)
  
      console.log(`>>> (communities.routes.js) Usuario ID ${requestingUserId} intentando cambiar rol de Usuario ID ${memberUserId} en Comunidad ID ${communityId} a ${newRole}`);
  
      try {
        // 1. Verificar que la comunidad exista y obtener el ID del creador
        const community = await prisma.community.findUnique({
          where: { id: communityId },
          select: { createdById: true }
        });
  
        if (!community) {
          return res.status(404).json({ error: 'Comunidad no encontrada.' });
        }
  
        // 2. Verificar que el usuario que hace la petición sea el CREADOR de la comunidad
        if (community.createdById !== requestingUserId) {
          return res.status(403).json({ error: 'Solo el creador de la comunidad puede cambiar roles de miembros.' });
        }
  
        // 3. Verificar que el usuario al que se le quiere cambiar el rol (memberUserId) no sea el propio creador
        if (memberUserId === requestingUserId) {
          return res.status(400).json({ error: 'El creador de la comunidad no puede cambiar su propio rol mediante este endpoint.' });
        }
  
        // 4. Encontrar la membresía existente del memberUserId en esta comunidad
        const membershipToUpdate = await prisma.communityMembership.findUnique({
          where: {
            userId_communityId: { // Usando el índice único compuesto
              userId: memberUserId,
              communityId: communityId
            }
          },
          select: { id: true, role: true } // Seleccionar el rol actual para validaciones
        });
  
        if (!membershipToUpdate) {
          return res.status(404).json({ error: 'El usuario especificado no es miembro de esta comunidad o la membresía no existe.' });
        }
  
        // 5. No permitir cambiar el rol de un CREADOR (si el miembro actual es el creador).
        // Esto es una doble seguridad además del chequeo del punto 3.
        if (membershipToUpdate.role === RoleInCommunity.CREATOR) {
            return res.status(400).json({ error: 'El rol de CREADOR no puede ser modificado a través de este endpoint.' });
        }
  
        // 6. No permitir cambiar el rol a CREADOR (solo se asigna al crear la comunidad)
        if (newRole === RoleInCommunity.CREATOR) {
            return res.status(400).json({ error: `No se puede asignar el rol de '${RoleInCommunity.CREATOR}' mediante este endpoint.` });
        }
        
        // 7. Si el rol actual ya es el nuevo rol, no hacer nada y devolver éxito (o un mensaje específico)
        if (membershipToUpdate.role === newRole) {
            return res.status(200).json({ 
                mensaje: `El miembro ya tiene el rol de '${newRole}'. No se realizaron cambios.`,
                membership: { // Devuelve la membresía actual para consistencia
                    id: membershipToUpdate.id,
                    role: membershipToUpdate.role,
                    // Añade otros campos que devuelves normalmente si es necesario
                }
            });
        }
  
        // 8. Actualizar el rol en el registro CommunityMembership
        const updatedMembership = await prisma.communityMembership.update({
          where: {
            id: membershipToUpdate.id // Usar el ID único de la membresía
          },
          data: {
            role: newRole 
          },
          select: { // Devolver la membresía actualizada con detalles
              id: true, role: true, assignedAt: true,
              user: { select: { id: true, email: true, tipo_usuario: true } }, // tipo_usuario global del User
              community: { select: { id: true, name: true } }
          }
        });
  
        console.log(`✅ (communities.routes.js) Rol de Usuario ID ${memberUserId} en Comunidad ID ${communityId} cambiado a ${newRole} por Creador ID ${requestingUserId}.`);
        res.status(200).json({
          mensaje: `Rol del miembro actualizado a ${newRole} exitosamente.`,
          membership: updatedMembership
        });
  
      } catch (error) {
        console.error(`❌ (communities.routes.js) Error en PATCH /:communityId/members/:memberUserId/role:`, error);
        if (error.code === 'P2025') { 
          return res.status(404).json({ error: 'Membresía, usuario o comunidad no encontrada para actualizar.', detalle: error.message });
        }
        res.status(500).json({ error: 'Error interno al actualizar el rol del miembro.', detalle: error.message });
      }
    }
  );
  
// --- Endpoint para que el CREADOR Expulse a un Miembro de la Comunidad ---
// Ruta: DELETE /api/communities/:communityId/members/:memberUserId
router.delete(
    '/:communityId/members/:memberUserId',
    authenticateToken,
    [
        param('communityId').isMongoId().withMessage('ID de comunidad inválido.'),
        param('memberUserId').isMongoId().withMessage('ID de usuario miembro a expulsar inválido.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { communityId, memberUserId } = req.params;
        const requestingUserId = req.userId; // Usuario que hace la petición

        console.log(`>>> (communities.routes.js) Usuario Creador ID ${requestingUserId} intentando expulsar a Usuario ID ${memberUserId} de Comunidad ID ${communityId}`);

        try {
            // 1. Verificar que la comunidad exista y obtener el ID del creador
            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true }
            });

            if (!community) {
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }

            // 2. Verificar que el usuario que hace la petición sea el CREADOR de la comunidad
            if (community.createdById !== requestingUserId) {
                return res.status(403).json({ error: 'Solo el creador de la comunidad puede expulsar miembros.' });
            }

            // 3. El creador no puede expulsarse a sí mismo mediante este endpoint
            if (memberUserId === requestingUserId) {
                return res.status(400).json({ error: 'El creador no puede expulsarse a sí mismo.' });
            }

            // 4. Buscar la membresía del usuario a expulsar para asegurarse de que es miembro
            //    y obtener el ID de la membresía para la eliminación.
            const membershipToExpel = await prisma.communityMembership.findUnique({
                where: {
                    userId_communityId: { // Usando el índice único compuesto
                        userId: memberUserId,
                        communityId: communityId
                    }
                },
                select: { id: true, role: true } // Seleccionar el ID para eliminar y el rol por si se quiere loguear info
            });

            if (!membershipToExpel) {
                return res.status(404).json({ error: 'El usuario especificado no es miembro de esta comunidad o ya fue eliminado.' });
            }
            
            // No se permite expulsar a otro CREATOR (aunque en la lógica actual solo hay un CREATOR por comunidad)
            // Esta es una salvaguarda adicional. El chequeo del punto 3 ya evita que el creador se auto-expulse.
            if (membershipToExpel.role === RoleInCommunity.CREATOR) {
                 return res.status(400).json({ error: 'No se puede expulsar al creador de la comunidad.' });
            }

            // 5. Eliminar el registro de CommunityMembership
            await prisma.communityMembership.delete({
                where: {
                    id: membershipToExpel.id // Usar el ID único de la membresía para la eliminación
                }
            });

            console.log(`✅ (communities.routes.js) Usuario ID ${memberUserId} (Rol: ${membershipToExpel.role}) expulsado de Comunidad ID ${communityId} por Creador ID ${requestingUserId}.`);
            res.status(200).json({ mensaje: `Miembro (ID: ${memberUserId}) expulsado de la comunidad exitosamente.` });

        } catch (error) {
            console.error(`❌ (communities.routes.js) Error en DELETE /:communityId/members/:memberUserId (expulsar):`, error);
            if (error.code === 'P2025') { // Record to delete not found
                return res.status(404).json({ error: 'Membresía no encontrada para eliminar (posiblemente ya fue eliminada).', detalle: error.message });
            }
            res.status(500).json({ error: 'Error interno al intentar expulsar al miembro.', detalle: error.message });
        }
    }
);  
// --- NUEVO: Endpoints para Logo de Comunidad ---
router.patch(
    '/:communityId/logo',
    authenticateToken,
    uploadLogo.single('communityLogo'), // Middleware de Multer
    [ param('communityId').isMongoId().withMessage('ID de comunidad inválido.') ],
    async (req, res) => {
        const errors = validationResult(req); // Validar params
        if (!errors.isEmpty()) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ errors: errors.array() });
        }

        if (req.fileValidationError) { // Validar error de tipo de archivo de Multer
            if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ errors: [{ msg: req.fileValidationError, path: 'communityLogo', location: 'file' }] });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No se proporcionó ningún archivo de imagen para el logo.' });
        }

        const { communityId } = req.params;
        const requestingUserId = req.userId;
        const tempFilePath = req.file.path;
        let cloudinaryResponse = null;

        console.log(`>>> (communities.routes.js) Usuario ID ${requestingUserId} intentando actualizar logo de Comunidad ID ${communityId}`);

        try {
            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true, logoPublicId: true }
            });

            if (!community) {
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }
            if (community.createdById !== requestingUserId) { // Solo el creador puede cambiar el logo
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                return res.status(403).json({ error: 'No tienes permiso para actualizar el logo de esta comunidad.' });
            }

            if (community.logoPublicId) { // Eliminar logo antiguo de Cloudinary
                try {
                    await deleteFromCloudinary(community.logoPublicId);
                    console.log(`>>> (communities.routes.js) Logo antiguo ${community.logoPublicId} eliminado.`);
                } catch (e) { console.warn(`⚠️ Fallo al eliminar logo antiguo ${community.logoPublicId}: ${e.message}`); }
            }

            cloudinaryResponse = await uploadToCloudinary(tempFilePath, "bulk_community_logos");
            console.log(`>>> (communities.routes.js) Logo subido a Cloudinary: ${cloudinaryResponse.url}`);

            const updatedCommunity = await prisma.community.update({
                where: { id: communityId },
                data: { logoUrl: cloudinaryResponse.url, logoPublicId: cloudinaryResponse.public_id },
                select: { id: true, name: true, logoUrl: true, bannerUrl: true } // Devolver info relevante
            });
            res.status(200).json({ mensaje: 'Logo de comunidad actualizado con éxito.', comunidad: updatedCommunity });
        } catch (error) {
            console.error(`❌ (communities.routes.js) Error en PATCH /:communityId/logo:`, error);
            if (cloudinaryResponse) { // Rollback
                try { await deleteFromCloudinary(cloudinaryResponse.public_id); console.log("Rollback de Cloudinary exitoso para logo."); }
                catch (e) { console.error("Error en rollback de Cloudinary para logo:", e); }
            }
            res.status(500).json({ error: 'Error interno al actualizar el logo.', detalle: error.message });
        } finally {
            if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        }
    }
);

router.delete(
    '/:communityId/logo',
    authenticateToken,
    [ param('communityId').isMongoId().withMessage('ID de comunidad inválido.') ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        
        const { communityId } = req.params;
        const requestingUserId = req.userId;
        try {
            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true, logoPublicId: true }
            });
            if (!community) return res.status(404).json({ error: 'Comunidad no encontrada.' });
            if (community.createdById !== requestingUserId) {
                return res.status(403).json({ error: 'No tienes permiso para eliminar el logo de esta comunidad.' });
            }
            if (!community.logoPublicId) return res.status(404).json({ error: 'La comunidad no tiene un logo para eliminar.' });

            await deleteFromCloudinary(community.logoPublicId);
            const updatedCommunity = await prisma.community.update({
                where: { id: communityId },
                data: { logoUrl: null, logoPublicId: null },
                select: { id: true, name: true, logoUrl: true, bannerUrl: true }
            });
            res.status(200).json({ mensaje: 'Logo de comunidad eliminado con éxito.', comunidad: updatedCommunity });
        } catch (error) {
            console.error(`❌ (communities.routes.js) Error en DELETE /:communityId/logo:`, error);
            // Similar al delete avatar, manejar si cloudinary dice "not found"
            if (error.message?.includes("not found") || error.result?.includes("not found")) {
                console.warn(`>>> Logo no encontrado en Cloudinary, limpiando DB.`);
                try {
                    const updatedCommunity = await prisma.community.update({ where: { id: communityId }, data: { logoUrl: null, logoPublicId: null }, select: { id: true, name: true, logoUrl: true, bannerUrl: true }});
                    return res.status(200).json({ mensaje: 'Logo no encontrado en proveedor, referencia eliminada.', comunidad: updatedCommunity });
                } catch (dbError) { return res.status(500).json({ error: 'Error limpiando DB tras Cloudinary not found.', detalle: dbError.message }); }
            }
            res.status(500).json({ error: 'Error interno al eliminar el logo.', detalle: error.message });
        }
    }
);

// --- NUEVO: Endpoints para Banner de Comunidad ---
router.patch(
    '/:communityId/banner',
    authenticateToken,
    uploadBanner.single('communityBanner'), // Middleware de Multer
    [ param('communityId').isMongoId().withMessage('ID de comunidad inválido.') ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ errors: errors.array() });
        }
        if (req.fileValidationError) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(400).json({ errors: [{ msg: req.fileValidationError, path: 'communityBanner', location: 'file' }] });
        }
        if (!req.file) return res.status(400).json({ error: 'No se proporcionó ningún archivo de imagen para el banner.' });

        const { communityId } = req.params;
        const requestingUserId = req.userId;
        const tempFilePath = req.file.path;
        let cloudinaryResponse = null;
        try {
            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true, bannerPublicId: true }
            });
            if (!community) { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); return res.status(404).json({ error: 'Comunidad no encontrada.' }); }
            if (community.createdById !== requestingUserId) { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); return res.status(403).json({ error: 'No tienes permiso para actualizar el banner.' }); }

            if (community.bannerPublicId) {
                try { await deleteFromCloudinary(community.bannerPublicId); console.log("Banner antiguo eliminado."); }
                catch (e) { console.warn(`⚠️ Fallo al eliminar banner antiguo: ${e.message}`); }
            }
            cloudinaryResponse = await uploadToCloudinary(tempFilePath, "bulk_community_banners");
            const updatedCommunity = await prisma.community.update({
                where: { id: communityId },
                data: { bannerUrl: cloudinaryResponse.url, bannerPublicId: cloudinaryResponse.public_id },
                select: { id: true, name: true, logoUrl: true, bannerUrl: true }
            });
            res.status(200).json({ mensaje: 'Banner de comunidad actualizado.', comunidad: updatedCommunity });
        } catch (error) {
            console.error(`❌ Error en PATCH /:communityId/banner:`, error);
            if (cloudinaryResponse) {
                try { await deleteFromCloudinary(cloudinaryResponse.public_id); console.log("Rollback de Cloudinary para banner."); }
                catch (e) { console.error("Error en rollback de Cloudinary para banner:", e); }
            }
            res.status(500).json({ error: 'Error interno al actualizar el banner.', detalle: error.message });
        } finally {
            if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        }
    }
);

router.delete(
    '/:communityId/banner',
    authenticateToken,
    [ param('communityId').isMongoId().withMessage('ID de comunidad inválido.') ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { communityId } = req.params;
        const requestingUserId = req.userId;
        try {
            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true, bannerPublicId: true }
            });
            if (!community) return res.status(404).json({ error: 'Comunidad no encontrada.' });
            if (community.createdById !== requestingUserId) return res.status(403).json({ error: 'No tienes permiso para eliminar el banner.' });
            if (!community.bannerPublicId) return res.status(404).json({ error: 'La comunidad no tiene un banner para eliminar.' });

            await deleteFromCloudinary(community.bannerPublicId);
            const updatedCommunity = await prisma.community.update({
                where: { id: communityId },
                data: { bannerUrl: null, bannerPublicId: null },
                select: { id: true, name: true, logoUrl: true, bannerUrl: true }
            });
            res.status(200).json({ mensaje: 'Banner de comunidad eliminado.', comunidad: updatedCommunity });
        } catch (error) {
            console.error(`❌ Error en DELETE /:communityId/banner:`, error);
            if (error.message?.includes("not found") || error.result?.includes("not found")) {
                console.warn(`Banner no encontrado en Cloudinary, limpiando DB.`);
                try {
                    const updatedCommunity = await prisma.community.update({ where: { id: communityId }, data: { bannerUrl: null, bannerPublicId: null }, select: { id: true, name: true, logoUrl: true, bannerUrl: true }});
                    return res.status(200).json({ mensaje: 'Banner no encontrado en proveedor, referencia eliminada.', comunidad: updatedCommunity });
                } catch (dbError) { return res.status(500).json({ error: 'Error limpiando DB tras Cloudinary not found.', detalle: dbError.message }); }
            }
            res.status(500).json({ error: 'Error interno al eliminar el banner.', detalle: error.message });
        }
    }
);

// --- NUEVA RUTA: Alternar permiso de publicación premium para un Moderador ---
router.patch(
    '/:communityId/members/:memberUserId/toggle-premium-permission',
    authenticateToken,
    [
        param('communityId').isMongoId().withMessage('ID de comunidad inválido.'),
        param('memberUserId').isMongoId().withMessage('ID de usuario miembro inválido.'),
        // El cuerpo del request contendrá el nuevo valor booleano para el permiso
        body('canPublishPremiumContent').isBoolean().withMessage('El valor del permiso debe ser booleano (true/false).').toBoolean()
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { communityId, memberUserId } = req.params;
        const requestingUserId = req.userId; // GURÚ que hace la petición
        const { canPublishPremiumContent: newPermissionValue } = req.body; // Nuevo valor del permiso

        console.log(`BACKEND: Usuario ${requestingUserId} intentando cambiar 'canPublishPremiumContent' a ${newPermissionValue} para miembro ${memberUserId} en comunidad ${communityId}`);

        try {
            // 1. Verificar que la comunidad exista y que el solicitante sea el creador
            const community = await prisma.community.findUnique({
                where: { id: communityId },
                select: { createdById: true }
            });

            if (!community) {
                return res.status(404).json({ error: 'Comunidad no encontrada.' });
            }
            if (community.createdById !== requestingUserId) {
                return res.status(403).json({ error: 'Solo el creador de la comunidad puede modificar este permiso.' });
            }

            // 2. Verificar que el memberUserId no sea el propio creador
            if (memberUserId === requestingUserId) {
                return res.status(400).json({ error: 'No puedes modificar este permiso para ti mismo como creador.' });
            }

            // 3. Encontrar la membresía del miembro y asegurarse de que sea MODERATOR
            const membership = await prisma.communityMembership.findUnique({
                where: {
                    userId_communityId: { userId: memberUserId, communityId: communityId }
                },
                select: { id: true, role: true, canPublishPremiumContent: true }
            });

            if (!membership) {
                return res.status(404).json({ error: 'El usuario especificado no es miembro de esta comunidad.' });
            }

            if (membership.role !== RoleInCommunity.MODERATOR) {
                return res.status(400).json({ error: 'Este permiso solo se puede aplicar a MODERADORES.' });
            }
            
            // Si el permiso actual ya es el que se quiere establecer, no hacer nada
            if (membership.canPublishPremiumContent === newPermissionValue) {
                return res.status(200).json({ 
                    mensaje: `El moderador ya tiene el permiso 'canPublishPremiumContent' establecido a ${newPermissionValue}. No se realizaron cambios.`,
                    membership: membership // Devolver la membresía actual
                });
            }

            // 4. Actualizar el permiso en la membresía
            const updatedMembership = await prisma.communityMembership.update({
                where: { id: membership.id },
                data: { canPublishPremiumContent: newPermissionValue },
                select: { // Devolver la info necesaria para el frontend
                    userId: true,
                    role: true,
                    canPublishPremiumContent: true,
                    user: { select: { email: true } } // Para identificar al usuario en el frontend
                }
            });

            res.status(200).json({
                mensaje: `Permiso de publicación premium para ${updatedMembership.user.email} ${newPermissionValue ? 'activado' : 'desactivado'}.`,
                membership: updatedMembership
            });

        } catch (error) {
            console.error(`BACKEND: Error en PATCH /:communityId/members/:memberUserId/toggle-premium-permission:`, error);
            if (error.code === 'P2025') { // Record to update not found
                return res.status(404).json({ error: 'Membresía no encontrada para actualizar.', detalle: error.message });
            }
            res.status(500).json({ error: 'Error interno al actualizar el permiso.', detalle: error.message });
        }
    }
);

// --- Endpoint para Eliminar una Comunidad (solo GURU creador) ---
// DELETE /api/communities/:communityId

router.delete(
  '/:communityId',
  authenticateToken,
  [
    param('communityId').isMongoId().withMessage("El ID de la comunidad no es válido.")
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const communityId = req.params.communityId;
    const userId = req.userId;

    try {
      // 1. Verificar si la comunidad existe y si el usuario es el creador
      const comunidad = await prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true, createdById: true }
      });

      if (!comunidad) {
        return res.status(404).json({ error: 'Comunidad no encontrada.' });
      }

      if (comunidad.createdById !== userId) {
        return res.status(403).json({ error: 'Solo el creador de la comunidad puede eliminarla.' });
      }

      console.log(`🧨 Eliminando comunidad ${communityId} por usuario ${userId}...`);

      // 2. Obtener todos los posts con imagenPublicId para limpiar en Cloudinary
      const posts = await prisma.post.findMany({
        where: { communityId },
        select: { id: true, imagePublicId: true }
      });

      // 3. Ejecutar eliminación en cascada con transacción
      await prisma.$transaction(async (tx) => {
        const postIds = posts.map(p => p.id);

        // Eliminar reacciones a los posts
        await tx.reaction.deleteMany({ where: { postId: { in: postIds } } });

        // Eliminar comentarios
        await tx.comment.deleteMany({ where: { postId: { in: postIds } } });

        // Eliminar posts
        await tx.post.deleteMany({ where: { id: { in: postIds } } });

        // Eliminar membresías
        await tx.communityMembership.deleteMany({ where: { communityId } });

        // Eliminar comunidad
        await tx.community.delete({ where: { id: communityId } });
      });

      // 4. Eliminar imágenes en Cloudinary (fuera de la transacción)
      for (const post of posts) {
        if (post.imagePublicId) {
          try {
            await deleteFromCloudinary(post.imagePublicId);
            console.log(`✅ Imagen ${post.imagePublicId} eliminada de Cloudinary.`);
          } catch (err) {
            console.warn(`⚠️ Error al borrar imagen ${post.imagePublicId} de Cloudinary: ${err.message}`);
          }
        }
      }

      res.status(200).json({ mensaje: 'Comunidad y recursos asociados eliminados con éxito.' });
    } catch (error) {
      console.error('❌ Error en DELETE /api/communities/:communityId:', error);
      res.status(500).json({ error: 'Error interno al eliminar la comunidad.', detalle: error.message });
    }
  }
);

// Ruta para suscribirse al contenido premium
router.post(
    '/:communityId/suscripcion', // La ruta ahora es relativa a /api/communities
    authenticateToken,
    [ param('communityId').isMongoId().withMessage('ID de comunidad inválido.') ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { communityId } = req.params;
        const userId = req.userId;
  
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { suscritoAComunidadesIds: true }
            });
            if (user.suscritoAComunidadesIds.includes(communityId)) {
                return res.status(200).json({ mensaje: 'Ya estás suscrito.' });
            }
  
            await prisma.user.update({
                where: { id: userId },
                data: { suscritoAComunidadesIds: { push: communityId } }
            });
            res.status(200).json({ mensaje: 'Suscripción al contenido premium realizada con éxito.' });
        } catch (error) {
            res.status(500).json({ error: 'Error interno al procesar la suscripción.', detalle: error.message });
        }
    }
);

// Ruta para cancelar la suscripción al contenido premium
router.delete(
    '/:communityId/suscripcion', // La ruta ahora es relativa a /api/communities
    authenticateToken,
    [ param('communityId').isMongoId().withMessage('ID de comunidad inválido.') ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        
        const { communityId } = req.params;
        const userId = req.userId;
  
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { suscritoAComunidadesIds: true }
            });
  
            if (!user || !user.suscritoAComunidadesIds.includes(communityId)) {
                 return res.status(200).json({ mensaje: 'No estabas suscrito a este contenido premium.'});
            }
  
            const nuevasSuscripciones = user.suscritoAComunidadesIds.filter(id => id !== communityId);
  
            await prisma.user.update({
                where: { id: userId },
                data: { suscritoAComunidadesIds: { set: nuevasSuscripciones } } 
            });
            res.status(200).json({ mensaje: 'Suscripción cancelada con éxito.' });
        } catch (error) { 
            res.status(500).json({ error: 'Error al cancelar la suscripción.', detalle: error.message });
        }
    }
);

module.exports = router;