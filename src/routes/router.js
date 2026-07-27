import express from "express";
import upload from "../middleware/upload.middleware.js";
import {
    deleteDataset,
    getDashboardMetrics,
    getDatasetById,
    getDatasetProfile,
    listDatasets,
    recordDatasetUsage,
    refreshDatasetScores,
    uploadDataset
} from "../controllers/dataset.controller.js";

const router = express.Router();

router.get("/health", (req, res) => {
    res.json({
        success: true,
        message: "API is healthy"
    });
});

router.get("/dashboard/metrics", getDashboardMetrics);

router.post("/datasets/upload", upload.single("file"), uploadDataset);
router.get("/datasets", listDatasets);
router.get("/datasets/:id", getDatasetById);
router.get("/datasets/:id/profile", getDatasetProfile);
router.post("/datasets/:id/usage", recordDatasetUsage);
router.post("/datasets/:id/scores/refresh", refreshDatasetScores);
router.delete("/datasets/:id", deleteDataset);

// Backward-compatible alias for the route that was created first.
router.post("/dateset/upload", upload.single("file"), uploadDataset);

export default router;
