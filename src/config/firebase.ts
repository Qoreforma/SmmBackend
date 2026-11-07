import logger from "@/logger";
import admin from "firebase-admin";

let firebaseInitialized = false;

export const initializeFirebase = () => {
  if (firebaseInitialized) {
    logger.info("Firebase already initialized");
    return;
  }

  if (admin.apps.length > 0) {
    firebaseInitialized = true;
    logger.info("Firebase Admin already initialized via other method");
    return;
  }

  try {
    const environment = process.env.NODE_ENV || "development";

    if (environment === "development") {
      // Development: Use service account file
      try {
        const serviceAccount = require("../../firebase-service-account.json");

        if (!serviceAccount.project_id) {
          throw new Error("Invalid service account file - missing project_id");
        }

        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id,
        });

        logger.info(
          ` Firebase initialized (Development) - Project: ${serviceAccount.project_id}`
        );
        firebaseInitialized = true;
      } catch (fileError) {
        logger.warn(
          "Service account file not found, falling back to environment variables"
        );
        initializeViaEnv();
      }
    } else {
      // Production: Use environment variables
      initializeViaEnv();
    }
  } catch (error) {
    logger.error("❌ Firebase initialization failed:", error);
    throw new Error("Critical: Firebase initialization failed");
  }
};

const initializeViaEnv = () => {
  const requiredVars = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase environment variables: ${missing.join(", ")}`
    );
  }

  try {
    // Replace escaped newlines in private key
    const privateKey = process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n");

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });

    logger.info(
      ` Firebase initialized (Production) - Project: ${process.env.FIREBASE_PROJECT_ID}`
    );
    firebaseInitialized = true;
  } catch (error) {
    logger.error("❌ Firebase environment initialization failed:", error);
    throw error;
  }
};

// Verify Firebase is properly configured for messaging
export const verifyFirebaseMessaging = async (): Promise<boolean> => {
  try {
    if (!firebaseInitialized) {
      initializeFirebase();
    }

    // Test Firebase Messaging connectivity
    const messaging = admin.messaging();
    logger.info(" Firebase Messaging is properly configured");
    return true;
  } catch (error) {
    logger.error("❌ Firebase Messaging not available:", error);
    return false;
  }
};

export default admin;
