const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Banco de dados conectado com sucesso.');
    } catch (error) {
        console.error('❌ Erro ao conectar no banco de dados:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;