// RUTA: utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    // ===== INICIO DE LA MODIFICACIÓN =====
    // Se añade esta sección para permitir certificados autofirmados
    // en el entorno de desarrollo local.
    tls: {
        rejectUnauthorized: false
    }
    // ===== FIN DE LA MODIFICACIÓN =====
});

// El resto de la función sendPasswordResetEmail no necesita cambios
exports.sendPasswordResetEmail = async (to, token) => {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;

    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: 'Restablecimiento de Contraseña para Bulk',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>Solicitud de Restablecimiento de Contraseña</h2>
                <p>Hola,</p>
                <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Bulk.</p>
                <p>Para establecer una nueva contraseña, haz clic en el siguiente enlace. Este enlace será válido por 1 hora:</p>
                <p style="text-align: center;">
                    <a href="${resetUrl}" style="background-color: #7E57C2; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Restablecer Contraseña</a>
                </p>
                <p>Si no solicitaste este cambio, puedes ignorar este correo de forma segura. Nadie ha accedido a tu cuenta.</p>
                <p>Saludos,<br>El equipo de Bulk</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Correo de reseteo enviado a:', to);
    } catch (error) {
        console.error('Error enviando correo de reseteo:', error);
        throw new Error('No se pudo enviar el correo de restablecimiento.');
    }
};

exports.sendVerificationEmail = async (to, token) => {
    const verificationUrl = `${process.env.BACKEND_URL}/api/auth/verify-email/${token}`;

    const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: to,
        subject: '¡Bienvenido a Bulk! Por favor, verifica tu correo',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>¡Bienvenido a Bulk!</h2>
                <p>Hola,</p>
                <p>Gracias por registrarte. Estamos muy contentos de tenerte a bordo.</p>
                <p>Solo falta un paso más para activar tu cuenta. Por favor, haz clic en el siguiente enlace para verificar tu dirección de correo electrónico:</p>
                <p style="text-align: center;">
                    <a href="${verificationUrl}" style="background-color: #7E57C2; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verificar mi Correo</a>
                </p>
                <p>Saludos,<br>El equipo de Bulk</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Correo de verificación enviado a:', to);
    } catch (error) {
        console.error('Error enviando correo de verificación:', error);
        throw new Error('No se pudo enviar el correo de verificación.');
    }
};