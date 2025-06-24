// routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');
const { body, validationResult } = require('express-validator');
const { UserType } = require('@prisma/client'); // Se importa el Enum
const crypto = require('crypto'); // Se añade la importación del módulo crypto
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/mailer');


const router = express.Router();

// --- Ruta de Registro con Verificación de Correo ---
router.post('/registro', 
    [ 
        body('email').isEmail().withMessage('Debe ser un email válido.').normalizeEmail(),
        body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.'),
        body('username').trim().notEmpty().withMessage('El nombre de usuario es obligatorio.')
            .isLength({ min: 3, max: 20 }).withMessage('El nombre de usuario debe tener entre 3 y 20 caracteres.')
            .matches(/^[a-zA-Z0-9_]+$/).withMessage('El nombre de usuario solo puede contener letras, números y guiones bajos.'),
        body('name').trim().notEmpty().withMessage('El nombre es obligatorio.'),
        body('tipo_usuario').isIn([UserType.OG, UserType.CREW]).withMessage(`Tipo de usuario debe ser '${UserType.OG}' o '${UserType.CREW}'.`),
        body('fechaDeNacimiento').optional({ checkFalsy: true }).isISO8601().withMessage('Fecha de nacimiento inválida.'),
        // ... (otras validaciones opcionales)
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password, tipo_usuario, name, username, ...profileData } = req.body;

        try {
            const saltRounds = 10;
            const passwordHasheada = await bcrypt.hash(password, saltRounds);
            
            // Se crea el usuario con isVerified en false
            const nuevoUsuario = await prisma.user.create({
                data: {
                    email,
                    password: passwordHasheada,
                    tipo_usuario,
                    name,
                    username,
                    ...profileData,
                    isVerified: false, 
                },
            });

            
             // ===== INICIO DE LA MODIFICACIÓN =====

            // Se genera y guarda el token de verificación
            const verificationToken = crypto.randomBytes(32).toString('hex');
            // Se hashea el token antes de guardarlo en la BD
            const hashedToken = crypto.createHash('sha256').update(verificationToken).digest('hex');

            await prisma.user.update({
                where: { id: nuevoUsuario.id },
                data: { emailVerificationToken: hashedToken }
            });

            // Se envía el token original (sin hashear) por correo
            await sendVerificationEmail(nuevoUsuario.email, verificationToken);

            // ===== FIN DE LA MODIFICACIÓN =====

            res.status(201).json({
                mensaje: 'Usuario registrado con éxito. Por favor, revisa tu correo para verificar tu cuenta.',
                usuario: { id: nuevoUsuario.id, email: nuevoUsuario.email }
            });

        } catch (error) {
            if (error.code === 'P2002') {
                 const field = error.meta?.target?.includes('email') ? 'email' : 'username';
                 return res.status(409).json({ error: `El ${field} proporcionado ya está en uso.` });
            }
            res.status(500).json({ error: 'Hubo un error al registrar el usuario.', detalle: error.message });
        }
    }
);

// --- Ruta de Inicio de Sesión con Comprobación de Verificación ---
router.post('/login', 
    [
        body('email').isEmail().withMessage('Debe ser un email válido.').normalizeEmail(),
        body('password').notEmpty().withMessage('La contraseña es obligatoria.')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const { email, password } = req.body;

        try {
            const user = await prisma.user.findUnique({ where: { email: email } });

            if (!user) {
                return res.status(401).json({ error: 'Credenciales inválidas.' });
            }

            // Comprobación de si el correo está verificado
            if (!user.isVerified) {
                return res.status(403).json({ error: 'Tu cuenta no ha sido verificada. Por favor, revisa tu correo electrónico.' });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);

            if (passwordMatch) {
                const token = jwt.sign(
                    { userId: user.id, email: user.email, tipo_usuario: user.tipo_usuario },
                    process.env.JWT_SECRET,
                    { expiresIn: '2h' }
                );
                
                res.status(200).json({
                    mensaje: 'Inicio de sesión exitoso',
                    token: token,
                    user: {
                        id: user.id,
                        email: user.email,
                        tipo_usuario: user.tipo_usuario,
                        username: user.username,
                        avatarUrl: user.avatarUrl,
                        name: user.name,
                        isVerified: user.isVerified // Se envía el estado de verificación
                    }
                });

            } else {
                res.status(401).json({ error: 'Credenciales inválidas.' });
            }

        } catch (error) {
            res.status(500).json({ error: 'Hubo un error en el servidor durante el login.', detalle: error.message });
        }
    }
);


/**
 * @route   POST /api/auth/forgot-password
 * @desc    Iniciar el proceso de reseteo de contraseña
 */
router.post('/forgot-password', [
    body('email').isEmail().withMessage('Por favor, ingresa un email válido.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    const { email } = req.body;

    try {
        const user = await prisma.user.findUnique({ where: { email } });

        if (user) {
            // Ahora 'crypto' está definido y esta sección funcionará
            const resetToken = crypto.randomBytes(32).toString('hex');
            const passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
            const passwordResetExpires = new Date(Date.now() + 3600000); // 1 hora de validez

            await prisma.user.update({
                where: { id: user.id },
                data: { passwordResetToken, passwordResetExpires }
            });

            await sendPasswordResetEmail(user.email, resetToken);
        }
        
        res.status(200).json({ message: 'Si tu correo está registrado, recibirás un enlace para restablecer tu contraseña.' });

    } catch (error) {
        console.error('Error en forgot-password:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});


/**
 * @route   POST /api/auth/reset-password/:token
 * @desc    Restablecer la contraseña usando el token
 */
router.post('/reset-password/:token', [
    body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        // Ahora 'crypto' está definido y esta sección funcionará
        const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

        const user = await prisma.user.findFirst({
            where: { 
                passwordResetToken: hashedToken,
                passwordResetExpires: { gt: new Date() }
            }
        });

        if (!user) {
            return res.status(400).json({ error: 'El token es inválido o ha expirado.' });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                passwordResetToken: null,
                passwordResetExpires: null
            }
        });

        res.status(200).json({ message: 'Tu contraseña ha sido restablecida con éxito.' });

    } catch (error) {
        console.error('Error en reset-password:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

/**
 * @route   GET /api/auth/verify-email/:token
 * @desc    Verificar el correo electrónico de un usuario
 */
router.get('/verify-email/:token', async (req, res) => {
    try {
        const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

        // Usamos updateMany porque nos devuelve un conteo de los registros actualizados.
        // Buscamos un usuario que tenga el token correcto Y que aún no esté verificado.
        const result = await prisma.user.updateMany({
            where: {
                emailVerificationToken: hashedToken,
                isVerified: false 
            },
            data: {
                isVerified: true,
                emailVerificationToken: null // Limpiamos el token para que no se pueda usar de nuevo
            }
        });

        // Si el conteo de usuarios actualizados es 0, significa que no se encontró
        // un usuario con ese token (o que ya estaba verificado). En cualquier caso, el token es inválido.
        if (result.count === 0) {
            // Redirigimos a la página de verificación con un parámetro de error
            return res.redirect(`${process.env.FRONTEND_URL}/email-verified?error=invalid_token`);
        }

        // Si count es 1 o más, la actualización fue exitosa. Redirigimos con un parámetro de éxito.
        res.redirect(`${process.env.FRONTEND_URL}/email-verified?success=true`);

    } catch (error) {
        console.error("Error en verify-email:", error);
        res.status(500).redirect(`${process.env.FRONTEND_URL}/email-verified?error=server_error`);
    }
});


module.exports = router;