// utils/cloudinary.js
const cloudinary = require('cloudinary').v2;
const dotenv = require('dotenv');

dotenv.config(); // Carga las variables de entorno del archivo .env

console.log("Cloudinary Cloud Name desde .env:", process.env.CLOUDINARY_CLOUD_NAME);
console.log("Cloudinary API Key desde .env:", process.env.CLOUDINARY_API_KEY ? 'Cargada' : 'NO CARGADA O VACÍA'); // No mostrar la key
console.log("Cloudinary API Secret desde .env:", process.env.CLOUDINARY_API_SECRET ? 'Cargada' : 'NO CARGADA O VACÍA'); // No mostrar el secret

// Configuración de Cloudinary con tus credenciales del .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Usar URLs HTTPS, recomendado
});

/**
 * Sube un archivo a Cloudinary.
 * @param {string} filePath - La ruta al archivo local que se va a subir.
 * @param {string} folder - La carpeta en Cloudinary donde se guardará el archivo (ej. "bulk_posts").
 * @returns {Promise<object>} Una promesa que resuelve con un objeto que contiene la URL y el public_id del archivo subido.
 */
const uploadToCloudinary = (filePath, folder = "bulk_posts") => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      {
        folder: folder, // Carpeta de destino en Cloudinary
        // Aquí podrías añadir más opciones de subida si las necesitas:
        // resource_type: "auto", // Detecta automáticamente si es imagen, video, etc.
        // unique_filename: true, // Cloudinary asignará un nombre único
        // overwrite: true, // Si se sube un archivo con el mismo public_id, lo sobrescribe
        // calidad, formato, transformaciones al subir, etc.
      },
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          reject(error);
        } else {
          resolve({
            url: result.secure_url,   // URL HTTPS del archivo
            public_id: result.public_id // ID único asignado por Cloudinary (importante para borrar/gestionar)
          });
        }
      }
    );
  });
};

/**
 * Elimina un archivo de Cloudinary usando su public_id.
 * @param {string} publicId - El public_id del archivo a eliminar.
 * @returns {Promise<object>} Una promesa que resuelve con el resultado de la operación de eliminación.
 */
const deleteFromCloudinary = (publicId) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, (error, result) => {
      if (error) {
        console.error("Cloudinary delete error:", error);
        reject(error);
      } else {
        resolve(result); // result puede contener { result: 'ok' } o { result: 'not found' }
      }
    });
  });
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  // Podrías exportar 'cloudinary' directamente si necesitas acceder a más funcionalidades del SDK:
  // cloudinaryInstance: cloudinary
};