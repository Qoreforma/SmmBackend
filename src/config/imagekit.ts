import ImageKit from "imagekit";

export interface ImageKitConfig {
  publicKey: string;
  privateKey: string;
  urlEndpoint: string;
  uploadFolders: {
    logos: string;
    featured: string;
    portfolio: string;
    banners: string;
    profiles: string;
  };
}

const imagekitConfig: ImageKitConfig = {
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "",
  uploadFolders: {
    logos: "vendor-logos",
    featured: "featured-images",
    portfolio: "portfolio-images",
    banners: "wedding-banners",
    profiles: "profile-pictures",
  },
};

export const imagekit = new ImageKit({
  publicKey: imagekitConfig.publicKey,
  privateKey: imagekitConfig.privateKey,
  urlEndpoint: imagekitConfig.urlEndpoint,
});

export { imagekitConfig };

export interface TransformationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: "auto" | "webp" | "jpg" | "png";
  progressive?: boolean;
  crop?: "maintain_ratio" | "force" | "at_least" | "at_max";
  cropMode?: "resize" | "extract" | "pad_extract" | "pad_resize";
}

export const getImagekitSignature = (token: string, expire: number) => {
  return imagekit.getAuthenticationParameters(token, expire);
};

export const validateImagekitWebhook = (
  body: any,
  signature: string
): boolean => {
  // Implement webhook signature validation
  const calculatedSignature = imagekit.getAuthenticationParameters(
    JSON.stringify(body),
    Date.now() + 3600
  ).signature;

  return calculatedSignature === signature;
};
