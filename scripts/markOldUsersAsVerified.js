// scripts/markOldUsersAsVerified.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando script con nuevo método...');
  try {
    // Paso 1: Obtenemos TODOS los usuarios, pero solo los campos que necesitamos.
    console.log('Obteniendo todos los usuarios de la base de datos...');
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        isVerified: true, // Traemos el campo, que será `null` o `undefined` si no existe.
      }
    });
    console.log(`Se encontraron ${allUsers.length} usuarios en total.`);

    // Paso 2: Filtramos en JavaScript para encontrar los IDs que necesitan actualización.
    // Un usuario necesita ser actualizado si su campo isVerified es falso, nulo o no existe.
    const idsToUpdate = allUsers
      .filter(user => !user.isVerified) // El '!' cubre los casos de false, null, y undefined.
      .map(user => user.id);

    if (idsToUpdate.length === 0) {
      console.log('¡No se encontraron usuarios que necesiten ser verificados! Parece que ya están todos al día.');
      await prisma.$disconnect();
      return;
    }

    console.log(`Se encontraron ${idsToUpdate.length} usuarios para verificar. Actualizando...`);

    // Paso 3: Ejecutamos una sola actualización masiva con los IDs que encontramos.
    const result = await prisma.user.updateMany({
      where: {
        id: {
          in: idsToUpdate,
        },
      },
      data: {
        isVerified: true,
        // También es buena idea limpiar cualquier token de verificación antiguo que pudiera existir.
        emailVerificationToken: null 
      },
    });

    console.log(`\n¡Proceso completado! Se han actualizado ${result.count} usuarios.`);
    console.log('Tus usuarios antiguos ahora pueden iniciar sesión sin problemas.');

  } catch (error) {
    console.error('Ocurrió un error durante la ejecución del script:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutamos la función principal
main();