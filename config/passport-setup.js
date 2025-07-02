const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const prisma = require('../prismaClient');

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

passport.use(
    new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/api/auth/google/callback',
        proxy: true
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            const existingUser = await prisma.user.findFirst({
                where: { googleId: profile.id },
            });

            if (existingUser) {
                return done(null, existingUser);
            }

            // ===== INICIO DE LA MODIFICACIÓN =====
            // Lógica para garantizar un nombre de usuario único
            let username = profile.displayName.replace(/\s+/g, '').toLowerCase();
            let isUsernameUnique = false;
            let counter = 0;

            while (!isUsernameUnique) {
                const potentialUsername = counter === 0 ? username : `${username}${counter}`;
                const userWithSameUsername = await prisma.user.findUnique({
                    where: { username: potentialUsername }
                });

                if (!userWithSameUsername) {
                    username = potentialUsername;
                    isUsernameUnique = true;
                } else {
                    counter++;
                }
            }
            // ===== FIN DE LA MODIFICACIÓN =====

            const newUser = await prisma.user.create({
                data: {
                    googleId: profile.id,
                    email: profile.emails[0].value,
                    username: username, // Se usa el username único garantizado
                    name: profile.displayName,
                    avatarUrl: profile.photos[0].value,
                    isVerified: true,
                    tipo_usuario: 'CREW'
                },
            });
            
            return done(null, newUser);

        } catch (error) {
            return done(error, false);
        }
    })
);