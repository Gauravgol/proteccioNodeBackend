import prisma from "./src/config/prisma.js";
import app from "./src/app.js";

const PORT = process.env.PORT || 5000;
let server;

const shutdown = async () => {
    if (server) {
        server.close();
    }

    await prisma.$disconnect();
    process.exit(0);
};

async function startServer() {
    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL");

        server = app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("❌ Database connection failed:", error);
        process.exit(1);
    }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startServer();
