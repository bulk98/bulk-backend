// RUTA: index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const prisma = require('./prismaClient');
const passport = require('passport');
const session = require('express-session');
require('./config/passport-setup.js');

// --- Imports de Routers ---
const authRoutes = require('./routes/auth.routes');
const communityRoutes = require('./routes/communities.routes');
const postRoutes = require('./routes/posts.routes');
const commentRoutes = require('./routes/comments.routes');
const userRoutes = require('./routes/users.routes.js');
const reactionRoutes = require('./routes/reactions.routes');
const searchRoutes = require('./routes/search.routes.js');
const notificationRoutes = require('./routes/notifications.routes');
const subscriptionPlanRoutes = require('./routes/subscriptionPlans.routes.js');

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: false
}));

const puerto = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// --- CORS controlado ---
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

const extraAllowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...extraAllowedOrigins])];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// --- Rate limit básico para API ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.'
  },
  skip: (req) => req.method === 'OPTIONS'
});

app.use('/api', apiLimiter);

// Sesión para Passport
app.use(session({
    secret: process.env.SESSION_SECRET || 'un-secreto-muy-secreto',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());

// --- Montar Routers ---
app.use('/api/auth', authRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api', postRoutes);
app.use('/api', commentRoutes);
app.use('/api', userRoutes);
app.use('/api', reactionRoutes);
app.use('/api/search', searchRoutes);
app.use('/api', notificationRoutes);
app.use('/api', subscriptionPlanRoutes);

// --- Middleware de Errores ---
app.use((err, req, res, next) => {
  if (req.fileValidationError) { 
    return res.status(400).json({ errors: [{ msg: req.fileValidationError, path: 'postImage', location: 'file' }] });
  }
  if (err instanceof multer.MulterError) { 
    console.error("Error de Multer detectado:", err); 
    let message = "Error de subida de archivo: " + err.message;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'El archivo es demasiado grande. Límite 10MB.';
    }
    return res.status(400).json({ 
        errors: [{ 
            msg: message, 
            code: err.code,
            path: err.field, 
            location: 'file'
        }]
    });
  } else if (err) {
    console.error("Error inesperado capturado por middleware global:", err.message, err.stack); 
    const errorMessage = err.message || "Error inesperado del servidor.";
    const errorStatus = err.status || err.statusCode || 500;
    return res.status(errorStatus).json({ error: "Error del servidor.", detalle: errorMessage });
  }
  next();
});

// --- Ruta Base ---
app.get('/', (req, res) => {
    res.send('¡El servidor backend de Bulk está funcionando y usando Prisma! 🚀');
});

// --- Lógica de Cierre Limpio ---
let prismaDisconnected = false;
const gracefulShutdown = async (signal) => {
  if (!prismaDisconnected) {
    console.log(`Recibida señal ${signal}. Desconectando cliente de Prisma...`);
    await prisma.$disconnect().catch(e => console.error("Error en desconexión de Prisma (gracefulShutdown):", e));
    console.log('Cliente de Prisma desconectado.');
    prismaDisconnected = true;
  }
  process.exit(signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); 
};

process.on('beforeExit', async () => { 
  if (!prismaDisconnected) {
    console.log('Evento beforeExit. Intentando desconectar cliente de Prisma...');
    await prisma.$disconnect().catch(e => console.error("Error en desconexión de Prisma (beforeExit):", e));
    console.log('Cliente de Prisma (probablemente) desconectado desde beforeExit.');
    prismaDisconnected = true; 
  }
});
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// --- Inicio del Servidor ---
app.listen(puerto, () => {
  console.log(`Servidor Express escuchando en http://localhost:${puerto}`);
});
