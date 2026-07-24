import prisma from "./src/config/prisma.js";
import app from "./src/app.js"
const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL");

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("❌ Database connection failed:", error);
    }
}

startServer();