import { Readable } from "stream";
import path from "path";
import csv from "csv-parser";
import XLSX from "xlsx";
import prisma from "../config/prisma.js";

const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);
const EMPTY_VALUES = new Set(["", "null", "undefined", "na", "n/a", "none"]);

const round = (value, decimals = 2) => {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(decimals));
};

const isMissing = (value) => {
    if (value === null || value === undefined) return true;
    return EMPTY_VALUES.has(String(value).trim().toLowerCase());
};

const normalizeColumnName = (name) => String(name || "").trim();

const parseDateValue = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const inferDataType = (values) => {
    const presentValues = values.filter((value) => !isMissing(value));

    if (presentValues.length === 0) return "UNKNOWN";

    const numericCount = presentValues.filter((value) => !Number.isNaN(Number(value))).length;
    if (numericCount / presentValues.length >= 0.9) return "NUMBER";

    const booleanValues = new Set(["true", "false", "yes", "no", "0", "1"]);
    const booleanCount = presentValues.filter((value) => booleanValues.has(String(value).trim().toLowerCase())).length;
    if (booleanCount / presentValues.length >= 0.9) return "BOOLEAN";

    const dateCount = presentValues.filter((value) => parseDateValue(value)).length;
    if (dateCount / presentValues.length >= 0.8) return "DATE";

    return "TEXT";
};

const classifyColumn = (columnName) => {
    const name = columnName.toLowerCase();

    if (/(password|secret|token|api[_\s-]?key|credential)/.test(name)) return "SECRET";
    if (/(email|e-mail|phone|mobile|contact|aadhaar|aadhar|pan|ssn|passport|dob|birth|address)/.test(name)) return "PII";
    if (/(amount|salary|income|revenue|price|cost|balance|payment|loan|credit|debit|account)/.test(name)) return "FINANCIAL";
    if (/(id|uuid|code|number|no)$/i.test(columnName) || /(^id$|[_\s-]id$)/.test(name)) return "IDENTIFIER";
    if (/(created|updated|date|time|timestamp)/.test(name)) return "TEMPORAL";

    return "GENERAL";
};

const getInvalidPercent = (values, dataType) => {
    const presentValues = values.filter((value) => !isMissing(value));
    if (presentValues.length === 0 || dataType === "UNKNOWN" || dataType === "TEXT") return 0;

    const invalidCount = presentValues.filter((value) => {
        if (dataType === "NUMBER") return Number.isNaN(Number(value));
        if (dataType === "BOOLEAN") {
            return !new Set(["true", "false", "yes", "no", "0", "1"]).has(String(value).trim().toLowerCase());
        }
        if (dataType === "DATE") return !parseDateValue(value);
        return false;
    }).length;

    return round((invalidCount / presentValues.length) * 100);
};

const calculateScores = ({ rowCount, columnCount, columnProfiles, usageCount = 0 }) => {
    if (rowCount === 0 || columnCount === 0) {
        return {
            qualityScore: 0,
            trustScore: 0,
            valueScore: 0
        };
    }

    const avgMissingPercent = columnProfiles.reduce((sum, column) => sum + column.missingPercent, 0) / columnProfiles.length;
    const avgInvalidPercent = columnProfiles.reduce((sum, column) => sum + column.invalidPercent, 0) / columnProfiles.length;
    const classifiedPercent = (columnProfiles.filter((column) => column.classification !== "UNKNOWN").length / columnProfiles.length) * 100;
    const sensitivePercent = (columnProfiles.filter((column) => ["PII", "FINANCIAL", "SECRET"].includes(column.classification)).length / columnProfiles.length) * 100;

    const qualityScore = Math.max(0, 100 - avgMissingPercent * 0.7 - avgInvalidPercent * 0.3);
    const trustScore = Math.max(0, Math.min(100, qualityScore * 0.65 + classifiedPercent * 0.25 + Math.min(usageCount, 10) * 1));
    const valueScore = Math.max(0, Math.min(100, qualityScore * 0.35 + Math.min(rowCount, 10000) / 100 + Math.min(columnCount, 50) + sensitivePercent * 0.2));

    return {
        qualityScore: round(qualityScore),
        trustScore: round(trustScore),
        valueScore: round(valueScore)
    };
};

const buildColumnProfiles = (rows) => {
    const columnsByName = rows.reduce((columns, row) => {
        Object.keys(row).forEach((column) => {
            const normalized = normalizeColumnName(column);
            if (normalized && !columns.has(normalized)) columns.set(normalized, column);
        });
        return columns;
    }, new Map());

    return Array.from(columnsByName.entries()).map(([columnName, rawColumnName]) => {
        const values = rows.map((row) => row[rawColumnName]);
        const dataType = inferDataType(values);
        const missingCount = values.filter(isMissing).length;

        return {
            columnName,
            dataType,
            classification: classifyColumn(columnName),
            missingPercent: rows.length ? round((missingCount / rows.length) * 100) : 0,
            invalidPercent: getInvalidPercent(values, dataType)
        };
    });
};

const parseUploadedFile = async (file) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        const error = new Error("Unsupported file type. Please upload a CSV or Excel file.");
        error.statusCode = 400;
        throw error;
    }

    if (extension === ".csv") {
        return new Promise((resolve, reject) => {
            const data = [];

            Readable.from(file.buffer)
                .pipe(csv())
                .on("data", (row) => data.push(row))
                .on("end", () => resolve(data))
                .on("error", reject);
        });
    }

    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" });
};

const buildDatasetResponse = (dataset) => ({
    ...dataset,
    usageCount: dataset._count?.usages ?? dataset.usageCount ?? undefined,
    _count: undefined
});

export const uploadDataset = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please upload a CSV or Excel file."
            });
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

        return res.status(201).json({
            success: true,
            message: "Dataset uploaded successfully.",
            data: buildDatasetResponse(dataset)
        });

    } catch (error) {
        console.error(error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
};

export const listDatasets = async (req, res) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
        const skip = (page - 1) * limit;
        const search = req.query.search?.trim();

        const where = search
            ? {
                filename: {
                    contains: search,
                    mode: "insensitive"
                }
            }
            : {};

        const [datasets, total] = await Promise.all([
            prisma.dataset.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    uploadedAt: "desc"
                },
                include: {
                    _count: {
                        select: {
                            usages: true,
                            columns: true
                        }
                    }
                }
            }),
            prisma.dataset.count({ where })
        ]);

        return res.json({
            success: true,
            data: datasets.map(buildDatasetResponse),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
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

export const getDatasetById = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({
            where: {
                id: req.params.id
            },
            include: {
                columns: {
                    orderBy: {
                        columnName: "asc"
                    }
                },
                usages: {
                    orderBy: {
                        viewedAt: "desc"
                    },
                    take: 10
                },
                _count: {
                    select: {
                        usages: true
                    }
                }
            }
        });

        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: "Dataset not found."
            });
        }

        await prisma.datasetUsage.create({
            data: {
                datasetId: dataset.id
            }
        });

        return res.json({
            success: true,
            data: buildDatasetResponse({
                ...dataset,
                usageCount: (dataset._count?.usages || 0) + 1
            })
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const getDatasetProfile = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({
            where: {
                id: req.params.id
            },
            select: {
                id: true,
                filename: true,
                rowCount: true,
                columnCount: true,
                qualityScore: true,
                trustScore: true,
                valueScore: true,
                columns: {
                    orderBy: {
                        columnName: "asc"
                    }
                }
            }
        });

        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: "Dataset not found."
            });
        }

        return res.json({
            success: true,
            data: dataset
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const recordDatasetUsage = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({
            where: {
                id: req.params.id
            }
        });

        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: "Dataset not found."
            });
        }

        const usage = await prisma.datasetUsage.create({
            data: {
                datasetId: dataset.id
            }
        });

        return res.status(201).json({
            success: true,
            message: "Dataset usage recorded.",
            data: usage
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const refreshDatasetScores = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({
            where: {
                id: req.params.id
            },
            include: {
                columns: true,
                _count: {
                    select: {
                        usages: true
                    }
                }
            }
        });

        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: "Dataset not found."
            });
        }

        const scores = calculateScores({
            rowCount: dataset.rowCount,
            columnCount: dataset.columnCount,
            columnProfiles: dataset.columns,
            usageCount: dataset._count.usages
        });

        const updatedDataset = await prisma.dataset.update({
            where: {
                id: dataset.id
            },
            data: scores,
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

        return res.json({
            success: true,
            message: "Dataset scores refreshed.",
            data: buildDatasetResponse(updatedDataset)
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const deleteDataset = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({
            where: {
                id: req.params.id
            }
        });

        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: "Dataset not found."
            });
        }

        await prisma.dataset.delete({
            where: {
                id: dataset.id
            }
        });

        return res.json({
            success: true,
            message: "Dataset deleted successfully."
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

export const getDashboardMetrics = async (req, res) => {
    try {
        const [datasetCount, columnCount, usageCount, datasets] = await Promise.all([
            prisma.dataset.count(),
            prisma.datasetColumn.count(),
            prisma.datasetUsage.count(),
            prisma.dataset.findMany({
                select: {
                    qualityScore: true,
                    trustScore: true,
                    valueScore: true,
                    rowCount: true
                }
            })
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

        return res.json({
            success: true,
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
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
