// prismaClient.js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient(); // Crea la instancia

module.exports = prisma; // Exporta la INSTANCIA