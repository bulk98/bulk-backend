// middleware/auth.middleware.js
const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        console.log('❌ Autenticación fallida: Token no proporcionado.');
        return res.status(401).json({ error: 'Acceso denegado: Token no proporcionado' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.log('❌ Autenticación fallida: Token inválido o expirado.');
            return res.status(403).json({ error: 'Acceso denegado: Token inválido o expirado' });
        }
        req.userId = user.userId;
        // console.log(`✅ Token verificado para el usuario ID: ${req.userId}`); // Puedes descomentar este log si lo necesitas
        next();
    });
}

module.exports = {
    authenticateToken
};