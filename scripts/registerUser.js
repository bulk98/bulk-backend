// scripts/registerUser.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function askQuestion(query) {
    return new Promise(resolve => {
        rl.question(query, (answer) => {
            resolve(answer.trim());
        });
    });
}

// VERSIÓN SIMPLIFICADA DE askPassword (mostrará la contraseña)
function askPasswordSimplified(query) {
    console.log('\nAVISO: La contraseña se mostrará mientras la escribes.');
    return new Promise(resolve => {
        rl.question(query, (password) => {
            resolve(password); // No se hace .trim() a las contraseñas generalmente
        });
    });
}

async function main() {
    console.log('--- Script de Registro de Nuevo Usuario ---');
    console.log('DEBUG: Iniciando función main...');

    try {
        console.log('DEBUG: A punto de preguntar por el email...');
        const email = await askQuestion('Introduce el email del nuevo usuario: ');
        console.log('DEBUG: Email recibido:', email);

        if (!email || !/\S+@\S+\.\S+/.test(email)) {
            console.error('Error: El email proporcionado no es válido.');
            return;
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            console.error(`Error: El email '${email}' ya está registrado.`);
            return;
        }

        console.log('DEBUG: A punto de preguntar por la contraseña (se mostrará)...');
        const password = await askPasswordSimplified('Introduce la contraseña (mín. 6 caracteres): '); // Usando la versión simplificada
        console.log('DEBUG: Contraseña recibida (longitud):', password ? password.length : 'undefined');


        if (!password || password.length < 6) {
            console.error('Error: La contraseña debe tener al menos 6 caracteres.');
            return;
        }

        let tipoUsuario = '';
        while (true) {
            console.log('DEBUG: A punto de preguntar por tipo de usuario...');
            tipoUsuario = await askQuestion('Introduce el tipo de usuario (GURU o MEMBER): ');
            console.log('DEBUG: Tipo de usuario recibido:', tipoUsuario);

            if (tipoUsuario === 'GURU' || tipoUsuario === 'MEMBER') {
                break; 
            } else {
                console.log('Tipo de usuario no válido. Por favor, introduce "GURU" o "MEMBER".');
            }
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const newUser = await prisma.user.create({
            data: {
                email: email,
                password: hashedPassword,
                tipo_usuario: tipoUsuario,
            },
        });

        console.log('\n¡Usuario registrado exitosamente!');
        console.log('------------------------------------');
        console.log(`ID: ${newUser.id}`);
        console.log(`Email: ${newUser.email}`);
        console.log(`Tipo de Usuario: ${newUser.tipo_usuario}`);
        console.log(`Fecha de Creación: ${newUser.createdAt}`);
        console.log('------------------------------------');

    } catch (error) {
        console.error('\nError durante el proceso de registro:', error);
        if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
            console.error('Detalle: El email proporcionado ya existe en la base de datos (error de Prisma).');
        }
    } finally {
        console.log('DEBUG: Entrando al bloque finally...');
        await prisma.$disconnect();
        rl.close(); 
        console.log('DEBUG: Prisma desconectado y readline cerrado.');
    }
}

console.log('DEBUG: Llamando a main()...');
main().then(() => {
    // console.log('DEBUG: main() ha completado su ejecución (then).');
}).catch(e => {
    // console.error('DEBUG: Error no capturado en la cadena de promesas de main():', e);
});
// console.log('DEBUG: main() ha sido llamado (después de la invocación).');