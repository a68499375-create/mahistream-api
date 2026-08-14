import samehadakuParser from "../parsers/samehadaku.parser.js";
import setPayload from "../helpers/setPayload.js";
const samehadakuController = {
    async search(req, res) {
        const query = req.query.q;
        if (!query)
            return res.status(400).json(setPayload(res, { message: "Query is required" }));
        try {
            const searchPromise = samehadakuParser.parseSearch(query);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 30000));
            const results = await Promise.race([searchPromise, timeoutPromise]);
            return res.status(200).json(setPayload(res, { data: { animeList: results } }));
        }
        catch (e) {
            return res.status(500).json(setPayload(res, { message: "Failed to search" }));
        }
    },
    async animeDetails(req, res) {
        const id = req.params.id;
        if (!id)
            return res.status(400).json(setPayload(res, { message: "ID is required" }));
        try {
            const details = await samehadakuParser.parseAnimeDetails(id);
            if (!details)
                return res.status(404).json(setPayload(res, { message: "Not found" }));
            return res.status(200).json(setPayload(res, { data: { details } }));
        }
        catch (e) {
            return res.status(500).json(setPayload(res, { message: "Failed to get anime details" }));
        }
    },
    async episodeDetails(req, res) {
        const id = req.params.id;
        if (!id)
            return res.status(400).json(setPayload(res, { message: "ID is required" }));
        try {
            const details = await samehadakuParser.parseEpisodeDetails(id);
            if (!details)
                return res.status(404).json(setPayload(res, { message: "Not found" }));
            return res.status(200).json(setPayload(res, { data: { details } }));
        }
        catch (e) {
            return res.status(500).json(setPayload(res, { message: "Failed to get episode details" }));
        }
    },
    async resolveStream(req, res) {
        const serverId = req.query.serverId;
        if (!serverId)
            return res.status(400).json(setPayload(res, { message: "serverId is required" }));
        try {
            const url = await samehadakuParser.parseStreamUrl(serverId);
            if (!url)
                return res.status(404).json(setPayload(res, { message: "Not found" }));
            return res.status(200).json(setPayload(res, { data: { url } }));
        }
        catch (e) {
            return res.status(500).json(setPayload(res, { message: "Failed to resolve stream" }));
        }
    }
};
export default samehadakuController;
