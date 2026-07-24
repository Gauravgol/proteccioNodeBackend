import express from "express";
import upload from "../middleware/upload.middleware.js";
import { uploadDataset } from "../controllers/dataset.controller.js";

const router = express.Router();

router.post("/dateset/upload",upload.single("file"), uploadDataset );

export default router;