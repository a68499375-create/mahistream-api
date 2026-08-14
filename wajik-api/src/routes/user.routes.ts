import express from 'express';
import multer from 'multer';
import path from 'path';
import { saveHistory, getHistory, deleteHistory, toggleBookmark, getBookmarks, getProfile, updateProfile } from '../controllers/user.controller.js';

const router = express.Router();

// Setup Multer Storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

router.post('/history', saveHistory);
router.get('/history', getHistory);
router.delete('/history', deleteHistory);
router.post('/bookmark', toggleBookmark);
router.get('/bookmark', getBookmarks);
router.get('/profile', getProfile);
router.post('/profile', updateProfile);

// Endpoint for file upload
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Return the relative URL of the uploaded file
  // Since we serve it via app.use('/uploads', ...), the path will be /uploads/filename
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

export default router;
