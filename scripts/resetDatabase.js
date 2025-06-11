// scripts/resetDatabase.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando el reseteo de las colecciones principales...');
  
  // Borramos en un orden que respete las relaciones para evitar errores
  // Como los posts, comentarios, etc., se borran en cascada al eliminar su User o Community,
  // solo necesitamos enfocarnos en los modelos principales.
  
  console.log('Eliminando comunidades...');
  const { count: communitiesCount } = await prisma.community.deleteMany({});
  console.log(`- Se eliminaron ${communitiesCount} comunidades.`);

  console.log('Eliminando usuarios...');
  const { count: usersCount } = await prisma.user.deleteMany({});
  console.log(`- Se eliminaron ${usersCount} usuarios.`);
  
  console.log('✅ Base de datos reseteada.');
}

main()
  .catch(e => {
    console.error('Error durante el reseteo de la base de datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });