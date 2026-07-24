import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import router from "./routes/router.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Data Governance API Running"
    });
});
app.use("/api",router)
app.use((err, req, res, next) => {
    console.error("Multer Error:", err);

    res.status(500).json({
        success: false,
        message: err.message,
        stack: err.stack
    });
});

export default app;