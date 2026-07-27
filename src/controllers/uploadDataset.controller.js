import { Readable } from "stream";
import path from "path";
import csv from "csv-parser";
import XLSX from "xlsx";
import prisma from "../config/prisma.js";
import { parseUploadedFile, buildColumnProfiles, calculateScores, buildDatasetResponse } from "../utils/commonUtils.js"

export const uploadDataset = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload a CSV or Excel file."});
        }

        const extension = path.extname(req.file.originalname).toLowerCase();
        const rows = await parseUploadedFile(req.file);
        const rowCount = rows.length;
        const columnProfiles = buildColumnProfiles(rows);
        const columnCount = columnProfiles.length;
        const scores = calculateScores({ rowCount, columnCount, columnProfiles });

        const dataset = await prisma.$transaction(async (tx) => {
            return tx.dataset.create({
                data: {
                    filename: req.file.originalname,
                    fileType: extension.replace(".", "").toUpperCase(),
                    filePath: req.file.originalname,
                    rowCount,
                    columnCount,
                    ...scores,
                    columns: {
                        create: columnProfiles
                    }
                },
                include: {
                    columns: {
                        orderBy: {
                            columnName: "asc"
                        }
                    },
                    _count: {
                        select: {
                            usages: true
                        }
                    }
                }
            });
        });

        return res.status(201).json({ success: true, message: "Dataset uploaded successfully.", data: buildDatasetResponse(dataset)});
    } catch (error) {
        console.error(error);
        return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

export const refreshDatasetScores = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id },
            include: { columns: true, _count: { select: { usages: true } } }
        });

        if (!dataset) {
            return res.status(404).json({ success: false, message: "Dataset not found."});
        }

        const scores = calculateScores({
            rowCount: dataset.rowCount,
            columnCount: dataset.columnCount,
            columnProfiles: dataset.columns,
            usageCount: dataset._count.usages
        });

        const updatedDataset = await prisma.dataset.update({
            where: { id: dataset.id },
            data: scores,
            include: {
                columns: { orderBy: { columnName: "asc" }},
                _count: { select: { usages: true } }
            }
        });

        return res.json({ success: true, message: "Dataset scores refreshed.", data: buildDatasetResponse(updatedDataset)});
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

