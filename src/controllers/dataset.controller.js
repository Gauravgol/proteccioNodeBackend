import { Readable } from "stream";
import path from "path";
import csv from "csv-parser";
import XLSX from "xlsx";
import prisma from "../config/prisma.js";

export const uploadDataset = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please upload a CSV or Excel file."
            });
        }

        const extension = path.extname(req.file.originalname).toLowerCase();
        const fileBuffer = req.file.buffer;

        let rows = [];

        // Read CSV
        if (extension === ".csv") {
            rows = await new Promise((resolve, reject) => {
                const data = [];

                Readable.from(fileBuffer)
                    .pipe(csv())
                    .on("data", (row) => data.push(row))
                    .on("end", () => resolve(data))
                    .on("error", reject);
            });
        }

        // Read Excel
        else if (extension === ".xlsx" || extension === ".xls") {
            const workbook = XLSX.read(fileBuffer, { type: "buffer" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet);
        }

        // Unsupported file type
        else {
            return res.status(400).json({
                success: false,
                message: "Unsupported file type. Please upload a CSV or Excel file."
            });
        }

        const rowCount = rows.length;
        const columnNames = rowCount > 0 ? Object.keys(rows[0]) : [];
        const columnCount = columnNames.length;

        const dataset = await prisma.dataset.create({
            data: {
                filename: req.file.originalname,
                fileType: extension.replace(".", "").toUpperCase(),
                rowCount,
                columnCount
            }
        });

        return res.status(201).json({
            success: true,
            message: "Dataset uploaded successfully.",
            data: {
                ...dataset,
                columns: columnNames
            }
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};