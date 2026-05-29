const CLIENT_ID = process.env.CLIENT_ID;
console.log("CLIENT_ID:", process.env.CLIENT_ID ? "FOUND" : "MISSING");
console.log("CLIENT_SECRET:", process.env.CLIENT_SECRET ? "FOUND" : "MISSING");
console.log("REFRESH_TOKEN:", process.env.REFRESH_TOKEN ? "FOUND" : "MISSING");
console.log("FOLDER_ID:", process.env.FOLDER_ID ? "FOUND" : "MISSING");

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { google } = require("googleapis");
const stream = require("stream");

const app = express();

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

const CLIENT_ID = process.env.CLIENT_ID;

const CLIENT_SECRET = process.env.CLIENT_SECRET;

const REDIRECT_URI = process.env.REDIRECT_URI;

const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

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
    console.log(token?.token);
  })
  .catch((err) => {
    console.error("❌ GOOGLE AUTH FAILED");
    console.error(err);
  });
const drive = google.drive({
  version: "v3",
  auth: oAuth2Client,
});
async function findOrCreateFolder(folderName, parentId = null) {
  let query = `
    mimeType='application/vnd.google-apps.folder'
    and name='${folderName}'
    and trashed=false
  `;

  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const response = await drive.files.list({
    q: query,
    fields: "files(id,name)",
  });

  if (response.data.files.length > 0) {
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
   GOOGLE DRIVE FOLDER ID
========================= */
const FOLDER_ID = process.env.FOLDER_ID;

/* =========================
   MULTER CONFIGURATION
========================= */
const upload = multer({
  storage: multer.memoryStorage(),
});

/* =========================
   FILE UPLOAD FUNCTION
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

    // =========================
    // AUTO FINANCIAL YEAR
    // =========================

    const today = new Date();

    const currentFY =
      today.getMonth() >= 3
        ? `${today.getFullYear()}-${(today.getFullYear() + 1)
            .toString()
            .slice(-2)}`
        : `${today.getFullYear() - 1}-${today
            .getFullYear()
            .toString()
            .slice(-2)}`;

    // =========================
    // CLIENT FOLDER
    // =========================

    const clientFolderId = await findOrCreateFolder(
      clientName,
      FOLDER_ID
    );

    let mainFolderId = clientFolderId;

    // =========================
    // SERVICE FOLDER
    // =========================

    if (category === "service") {

      const serviceRootFolder = await findOrCreateFolder(
        "Service & Product",
        clientFolderId
      );

      // FY FOLDER
      const financialFolderId = await findOrCreateFolder(
        currentFY,
        serviceRootFolder
      );

      mainFolderId = await findOrCreateFolder(
        serviceName || "General Service",
        financialFolderId
      );
    }

    // =========================
    // AMC FOLDER
    // =========================

    if (category === "amc") {

      const amcRootFolder = await findOrCreateFolder(
        "AMC",
        clientFolderId
      );

      // FY FOLDER
      const financialFolderId = await findOrCreateFolder(
        currentFY,
        amcRootFolder
      );

      // AMC NAME FOLDER
      mainFolderId = await findOrCreateFolder(
        serviceName || "General AMC",
        financialFolderId
      );

      // CONTRACT DURATION FOLDER
      if (amcStartDate && amcEndDate) {

        const contractFolderName =
          `${amcStartDate}_TO_${amcEndDate}`;

        mainFolderId = await findOrCreateFolder(
          contractFolderName,
          mainFolderId
        );
      }
    }

    // =========================
    // DOC TYPE FOLDER
    // =========================

    const docFolderId = await findOrCreateFolder(
      docType || "Documents",
      mainFolderId
    );

    // =========================
    // FILE UPLOAD
    // =========================

    const mediaStream = stream.Readable.from(file.buffer);
    console.log("UPLOAD SUCCESS");
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
   SERVICE DOCS ROUTE
========================= */
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

    const uploadedFiles = [];
    for (const file of req.files) {
      
file.category = "Service";

const clientName = req.body.clientName || "Unknown Client";
const serviceName = req.body.serviceName || "General Service";

const uploaded = await uploadFileToDrive(
  file,
  clientName,
  serviceName,
  null,
  req.body.docType,
  "service"
);
      uploadedFiles.push(uploaded);
    }

    res.json({
      success: true,
      files: uploadedFiles,
    });

  } catch (err) {
    console.error("SERVICE UPLOAD ROUTE ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/* =========================
   AMC DOCS ROUTE
========================= */
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

    const uploadedFiles = [];
    for (const file of req.files) {
      
file.category = "AMC";

const amcName = req.body.amcName || "General AMC";

const uploaded = await uploadFileToDrive(
  file,
  req.body.clientName || "Unknown Client",
  amcName,
  null,
  req.body.docType,
  "amc",
  req.body.amcStartDate,
  req.body.amcEndDate
);
      uploadedFiles.push(uploaded);
    }

    res.json({
      success: true,
      files: uploadedFiles,
    });

  } catch (err) {
    console.error("AMC UPLOAD ROUTE ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
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
  console.log(`🚀 Server running dynamically on port ${PORT}`);
});
/* =========================
   DELETE FILE ROUTE
========================= */

app.delete("/delete-file/:fileId", async (req, res) => {
  try {

    const { fileId } = req.params;

    console.log("Deleting file:", fileId);

    await drive.files.delete({
      fileId: fileId,
      supportsAllDrives: true,
    });

    res.json({
      success: true,
      message: "File deleted successfully",
    });

  } catch (err) {

    console.error("DELETE FILE ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});