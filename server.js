require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { google } = require("googleapis");
const stream = require("stream");

const app = express();

/* =========================
   ENVIRONMENT VARIABLES
========================= */
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const FOLDER_ID = process.env.FOLDER_ID;
const BACKUPS_FOLDER_ID = process.env.BACKUPS_FOLDER_ID; // NEW

/* =========================
   DEBUG LOGS
========================= */
console.log("CLIENT_ID:", CLIENT_ID ? "FOUND" : "MISSING");
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "FOUND" : "MISSING");
console.log("REFRESH_TOKEN:", REFRESH_TOKEN ? "FOUND" : "MISSING");
console.log("FOLDER_ID:", FOLDER_ID ? "FOUND" : "MISSING");
console.log("BACKUPS_FOLDER_ID:", BACKUPS_FOLDER_ID ? "FOUND" : "MISSING");

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});

/* =========================
   GOOGLE DRIVE AUTH
========================= */
const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

oAuth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN,
});

oAuth2Client.getAccessToken()
  .then((token) => {
    console.log("✅ GOOGLE AUTH SUCCESS");
  })
  .catch((err) => {
    console.error("❌ GOOGLE AUTH FAILED");
    console.error(err);
  });

const drive = google.drive({
  version: "v3",
  auth: oAuth2Client,
});

/* =========================
   FIND OR CREATE FOLDER (FIXED - removed extra space)
========================= */
async function findOrCreateFolder(folderName, parentId = null) {
  let query = `
    mimeType='application/vnd.google-apps.folder'
    and name='${folderName.replace(/'/g, "\\'")}'
    and trashed=false
  `;

  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const response = await drive.files.list({
    q: query,
    fields: "files(id,name)",
  });

  if (response.data?.files?.length > 0) {
    return response.data.files[0].id;
  }

  const folderMetadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };

  if (parentId) {
    folderMetadata.parents = [parentId];
  }

  const folder = await drive.files.create({
    requestBody: folderMetadata,
    fields: "id",
  });

  return folder.data.id;
}

/* =========================
   MULTER CONFIGURATION
========================= */
const upload = multer({
  storage: multer.memoryStorage(),
});

/* =========================
   FILE UPLOAD FUNCTION (EXISTING - KEPT INTACT)
========================= */
async function uploadFileToDrive(
  file,
  clientName,
  serviceName,
  financialYear,
  docType,
  category,
  amcStartDate = null,
  amcEndDate = null
) {
  try {
    console.log("Uploading:", file.originalname);

    const today = new Date();

    const currentFY =
      today.getMonth() >= 3
        ? `${today.getFullYear()}-${(today.getFullYear() + 1).toString().slice(-2)}`
        : `${today.getFullYear() - 1}-${today.getFullYear().toString().slice(-2)}`;

    const clientFolderId = await findOrCreateFolder(clientName, FOLDER_ID);
    let mainFolderId = clientFolderId;

    if (category === "service") {
      const serviceRootFolder = await findOrCreateFolder("Service & Product", clientFolderId);
      const financialFolderId = await findOrCreateFolder(currentFY, serviceRootFolder);
      mainFolderId = await findOrCreateFolder(serviceName || "General Service", financialFolderId);
    }

    if (category === "amc") {
      const amcRootFolder = await findOrCreateFolder("AMC", clientFolderId);
      const financialFolderId = await findOrCreateFolder(currentFY, amcRootFolder);
      mainFolderId = await findOrCreateFolder(serviceName || "General AMC", financialFolderId);
    }

    const docFolderId = await findOrCreateFolder(docType || "Documents", mainFolderId);

    const mediaStream = stream.Readable.from(file.buffer);

    const response = await drive.files.create({
      requestBody: {
        name: file.originalname,
        parents: [docFolderId],
      },
      media: {
        mimeType: file.mimetype,
        body: mediaStream,
      },
      fields: "id,name,webViewLink",
    });

    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    return {
      fileName: file.originalname,
      url: response.data.webViewLink,
      driveFileId: response.data.id,
    };
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    throw err;
  }
}

/* =========================
   EXISTING ROUTES (KEPT INTACT)
========================= */

// SERVICE DOCS ROUTE
app.post("/upload-service-docs", upload.any(), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("SERVICE FILES RECEIVED:", req.files);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files received",
      });
    }

    const uploadedFiles = await Promise.all(
      req.files.map(async (file) => {
        return await uploadFileToDrive(
          file,
          req.body.clientName || "Unknown Client",
          req.body.serviceName || "General Service",
          null,
          req.body.docType,
          "service"
        );
      })
    );

    res.json({ success: true, files: uploadedFiles });

  } catch (err) {
    console.error("SERVICE UPLOAD ROUTE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// AMC DOCS ROUTE
app.post("/upload-amc-docs", upload.any(), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("AMC FILES RECEIVED:", req.files);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files received",
      });
    }

    const uploadedFiles = await Promise.all(
      req.files.map(async (file) => {
        return await uploadFileToDrive(
          file,
          req.body.clientName || "Unknown Client",
          req.body.serviceName || "General AMC",
          null,
          req.body.docType,
          "amc",
          req.body.amcStartDate,
          req.body.amcEndDate
        );
      })
    );

    res.json({ success: true, files: uploadedFiles });

  } catch (err) {
    console.error("AMC UPLOAD ROUTE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE FILE ROUTE
app.delete("/delete-file/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    console.log("Deleting file:", fileId);

    await drive.files.delete({
      fileId,
      supportsAllDrives: true,
    });

    res.json({
      success: true,
      message: "File deleted successfully",
    });

  } catch (err) {
    console.error("DELETE FILE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================
   NEW AUTO-BACKUP ROUTES
========================= */

// WEEKLY BACKUP UPLOAD ROUTE (Supports both JSON and Excel with Day-wise folders)
app.post("/upload-weekly-backup", upload.single("file"), async (req, res) => {
  try {
    const { weekday, backupType, timestamp } = req.body;
    const file = req.file;
    
    if (!file || !weekday) {
      return res.status(400).json({ success: false, error: 'Missing file or weekday' });
    }
    
 
    console.log(`📤 Receiving ${backupType || 'JSON'} backup for ${weekday}`);
    
    // Create main backups folder at ROOT level
    let backupsFolderId = BACKUPS_FOLDER_ID;
    if (!backupsFolderId) {
      backupsFolderId = await findOrCreateFolder("NetCom CRM Backups", null);
      console.log(`📁 Created backups folder at ROOT level: ${backupsFolderId}`);
    }
    
    // Create day-wise folder (Monday, Tuesday, etc.)
    const dayFolderId = await findOrCreateFolder(weekday, backupsFolderId);
    
    // Create subfolders for JSON and Excel
    const jsonFolderId = await findOrCreateFolder("JSON", dayFolderId);
    const excelFolderId = await findOrCreateFolder("Excel", dayFolderId);
    
    // Determine which folder to use
    let targetFolderId;
    let fileName;
    
    if (backupType === 'excel') {
      targetFolderId = excelFolderId;
      fileName = `backup.xlsx`;
    } else {
      targetFolderId = jsonFolderId;
      fileName = `backup.json`;
    }
    
    // Check if file already exists
    const query = `name='${fileName}' and '${targetFolderId}' in parents and trashed=false`;
    const existingFiles = await drive.files.list({
      q: query,
      fields: "files(id, name)"
    });
    
    // Delete existing file if it exists (replace it)
    if (existingFiles.data.files.length > 0) {
      for (const existingFile of existingFiles.data.files) {
        await drive.files.delete({ fileId: existingFile.id });
        console.log(`🗑️ Deleted old ${weekday} ${backupType} backup`);
      }
    }
    
    // Upload new file
    const mediaStream = stream.Readable.from(file.buffer);
    
    const fileMetadata = {
      name: fileName,
      parents: [targetFolderId],
    };
    
    if (backupType === 'excel') {
      fileMetadata.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      fileMetadata.mimeType = 'application/json';
    }
    
    const uploadedFile = await drive.files.create({
      requestBody: fileMetadata,
      media: {
        mimeType: file.mimetype,
        body: mediaStream,
      },
      fields: 'id, name, webViewLink'
    });
    
    // Make file publicly readable
    await drive.permissions.create({
      fileId: uploadedFile.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
    
    console.log(`✅ Uploaded ${weekday} ${backupType} backup (replaced old one)`);
    
    res.json({
      success: true,
      message: `${weekday} ${backupType || 'JSON'} backup uploaded successfully`,
      fileId: uploadedFile.data.id,
      fileLink: uploadedFile.data.webViewLink
    });
    
  } catch (error) {
    console.error('Upload backup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET WEEKLY BACKUP ROUTE (FIXED - looks at ROOT level)
app.get("/get-weekly-backup/:weekday", async (req, res) => {
  try {
    const { weekday } = req.params;
    
    let backupsFolderId = BACKUPS_FOLDER_ID;
    
    if (!backupsFolderId) {
      // Look for folder at ROOT level
      backupsFolderId = await findOrCreateFolder("NetCom CRM Backups", null);
    }
    
    const fileName = `${weekday}.json`;
    const query = `name='${fileName}' and '${backupsFolderId}' in parents and trashed=false`;
    
    const files = await drive.files.list({
      q: query,
      fields: "files(id, name, webViewLink)"
    });
    
    if (files.data.files.length > 0) {
      res.json({ success: true, file: files.data.files[0] });
    } else {
      res.status(404).json({ success: false, error: 'Backup not found' });
    }
  } catch (error) {
    console.error('Get backup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* =========================
   TEST ROUTE
========================= */
app.get("/", (req, res) => {
  res.send("NetCom CRM Node Backend Running");
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});