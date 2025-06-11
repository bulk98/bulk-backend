// routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');
const { body, validationResult } = require('express-validator');
const { UserType } = require('@prisma/client'); // Se importa el Enum

const router = express.Router();

// --- Ruta de Registro ACTUALIZADA ---
router.post('/registro', 
    [ 
        // Validaciones para todos los nuevos campos
        body('email').isEmail().withMessage('Debe ser un email válido.').normalizeEmail(),
        body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres.'),
        body('username').trim().notEmpty().withMessage('El nombre de usuario es obligatorio.')
            .isLength({ min: 3, max: 20 }).withMessage('El nombre de usuario debe tener entre 3 y 20 caracteres.')
            .matches(/^[a-zA-Z0-9_]+$/).withMessage('El nombre de usuario solo puede contener letras, números y guiones bajos.'),
        body('name').trim().notEmpty().withMessage('El nombre es obligatorio.'),
        body('tipo_usuario').isIn([UserType.OG, UserType.CREW]).withMessage(`Tipo de usuario debe ser '${UserType.OG}' o '${UserType.CREW}'.`),
        
        // Validaciones opcionales
        body('fechaDeNacimiento').optional({ checkFalsy: true }).isISO8601().toDate().withMessage('Fecha de nacimiento inválida.'),
        body('paisDeNacimiento').optional().trim(),
        body('ciudadDeNacimiento').optional().trim(),
        body('domicilio').optional().trim(),
        body('celular').optional().trim(),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { 
            email, password, tipo_usuario, 
            name, username, fechaDeNacimiento, 
            paisDeNacimiento, ciudadDeNacimiento, domicilio, celular 
        } = req.body;

        try {
            const saltRounds = 10;
            const passwordHasheada = await bcrypt.hash(password, saltRounds);
            
            const nuevoUsuario = await prisma.user.create({
                data: {
                    email,
                    password: passwordHasheada,
                    tipo_usuario,
                    name,
                    username,
                    fechaDeNacimiento,
                    paisDeNacimiento,
                    ciudadDeNacimiento,
                    domicilio,
                    celular,
                },
                select: { id: true, email: true, username: true, tipo_usuario: true }
            });

            res.status(201).json({
                mensaje: 'Usuario registrado con éxito',
                usuario: nuevoUsuario
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

// --- Ruta de Inicio de Sesión (Login) ACTUALIZADA ---
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
                        name: user.name
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

module.exports = router;