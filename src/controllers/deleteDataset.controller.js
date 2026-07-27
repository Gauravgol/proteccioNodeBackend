import prisma from "../config/prisma.js";


export const deleteDataset = async (req, res) => {
    try {
        const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id }});
        if (!dataset) {
            return res.status(404).json({ success: false, message: "Dataset not found."});
        }

        await prisma.dataset.delete({ where: { id: dataset.id }});
        return res.json({ success: true, message: "Dataset deleted successfully."});
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
