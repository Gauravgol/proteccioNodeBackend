import multer from "multer";

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.has(file.mimetype) || /\.(csv|xls|xlsx)$/i.test(file.originalname)) {
            return cb(null, true);
        }

        return cb(new Error("Only CSV and Excel files are allowed."));
    }
});

export default upload;
