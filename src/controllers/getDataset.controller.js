import prisma from "../config/prisma.js";
import { buildDatasetResponse } from "../utils/commonUtils.js"

export const getDatasetById = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({
            where: { id: req.params.id },
            include: {
                columns: { orderBy: { columnName: "asc" } },
                usages: { orderBy: { viewedAt: "desc" }, take: 10 },
                _count: { select: { usages: true } }
            }
        });

        if (!dataset) {
            return res.status(404).json({ success: false, message: "Dataset not found." });
        }
        await prisma.datasetUsage.create({ data: { datasetId: dataset.id } });
        return res.json({ success: true, data: buildDatasetResponse({ ...dataset, usageCount: (dataset._count?.usages || 0) + 1 }) });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getDatasetProfile = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                filename: true,
                rowCount: true,
                columnCount: true,
                qualityScore: true,
                trustScore: true,
                valueScore: true,
                columns: { orderBy: { columnName: "asc" } }
            }
        });

        if (!dataset) {
            return res.status(404).json({ success: false, message: "Dataset not found." });
        }

        return res.json({ success: true, data: dataset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const listDatasets = async (req, res) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
        const skip = (page - 1) * limit;
        const search = req.query.search?.trim();

        const where = search ? { filename: { contains: search, mode: "insensitive" } } : {};

        const [datasets, total] = await Promise.all([prisma.dataset.findMany({
            where, skip, take: limit,
            orderBy: { uploadedAt: "desc" },
            include: { _count: { select: { usages: true, columns: true } } }
        }),
        prisma.dataset.count({ where })
        ]);

        return res.json({ success: true, data: datasets.map(buildDatasetResponse),pagination: { page, limit, total, totalPages: Math.ceil(total / limit)} });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const getDashboardMetrics = async (req, res) => {
    try {
        const [datasetCount, columnCount, usageCount, datasets] = await Promise.all([ prisma.dataset.count(), prisma.datasetColumn.count(), prisma.datasetUsage.count(),
            prisma.dataset.findMany({ select: { qualityScore: true, trustScore: true, valueScore: true, rowCount: true}})
        ]);

        const totals = datasets.reduce(
            (acc, dataset) => {
                acc.qualityScore += dataset.qualityScore || 0;
                acc.trustScore += dataset.trustScore || 0;
                acc.valueScore += dataset.valueScore || 0;
                acc.rowCount += dataset.rowCount || 0;
                return acc;
            },
            {
                qualityScore: 0,
                trustScore: 0,
                valueScore: 0,
                rowCount: 0
            }
        );

        return res.json({ success: true,
            data: {
                datasetCount,
                columnCount,
                usageCount,
                rowCount: totals.rowCount,
                averageQualityScore: datasetCount ? round(totals.qualityScore / datasetCount) : 0,
                averageTrustScore: datasetCount ? round(totals.trustScore / datasetCount) : 0,
                averageValueScore: datasetCount ? round(totals.valueScore / datasetCount) : 0
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

export const recordDatasetUsage = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });

        if (!dataset) {
            return res.status(404).json({ success: false, message: "Dataset not found." });
        }

        const usage = await prisma.datasetUsage.create({ data: { datasetId: dataset.id }});

        return res.status(201).json({ success: true, message: "Dataset usage recorded.", data: usage });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

