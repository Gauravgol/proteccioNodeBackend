import path from "path";
import { Readable } from "stream";
import csv from "csv-parser";
import XLSX from "xlsx";

const buildDatasetResponse = (dataset) => ({
    ...dataset,
    usageCount: dataset._count?.usages ?? dataset.usageCount ?? undefined,
    _count: undefined
});

const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);
const EMPTY_VALUES = new Set(["", "null", "undefined", "na", "n/a", "none"]);


export const round = (value, decimals = 2) => {
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

export { parseUploadedFile, buildColumnProfiles, calculateScores, buildDatasetResponse };