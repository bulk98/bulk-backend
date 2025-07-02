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
// Se elimina la siguiente línea porque el archivo ya no existe
// const subscriptionRoutes = require('./routes/subscriptions.routes.js'); 
const userRoutes = require('./routes/users.routes.js');
const reactionRoutes = require('./routes/reactions.routes');
const searchRoutes = require('./routes/search.routes.js');
const notificationRoutes = require('./routes/notifications.routes');
const subscriptionPlanRoutes = require('./routes/subscriptionPlans.routes.js');

const app = express();
const puerto = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors('*'));

// Se configura la sesión de Express, necesaria para Passport
app.use(session({
    secret: process.env.SESSION_SECRET || 'un-secreto-muy-secreto', // Añade SESSION_SECRET a tu .env
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true en producción
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Se inicializa Passport
app.use(passport.initialize());
app.use(passport.session());
// ===== FIN DE LA MODIFICACIÓN =====

// --- Montar Routers ---
app.use('/api/auth', authRoutes);
app.use('/api/communities', communityRoutes); // Ahora maneja también las suscripciones
app.use('/api', postRoutes);
app.use('/api', commentRoutes);
// Se elimina la siguiente línea
// app.use('/api', subscriptionRoutes); 
app.use('/api', userRoutes); 
app.use('/api', reactionRoutes);
app.use('/api/search', searchRoutes);
app.use('/api', notificationRoutes);
app.use('/api', subscriptionPlanRoutes);

// --- Middleware de Errores (sin cambios) ---
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

// --- Ruta Base (sin cambios) ---
app.get('/', (req, res) => {
    res.send('¡El servidor backend de Bulk está funcionando y usando Prisma!');
});


// --- Lógica de Cierre Limpio (sin cambios) ---
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


// --- Inicio del Servidor (sin cambios) ---
app.listen(puerto, () => {
  console.log(`Servidor Express escuchando en http://localhost:${puerto}`);
});