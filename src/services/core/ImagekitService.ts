import { imagekit } from "../../config/imagekit";

export class ImageKitService {
  async generateUploadSignatureWithDetails(folder: string, fileName: string) {
    const token = Date.now().toString();
    const expire = Math.floor(Date.now() / 1000) + 1800; // 30 minutes instead of 1 hour
    const authParams = imagekit.getAuthenticationParameters(token, expire);
    return {
      signature: authParams.signature,
      expire: authParams.expire,
      token: authParams.token,
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      uploadOptions: {
        folder: `pebliss/${folder}`,
        fileName: fileName,
        useUniqueFileName: true,
        transformation: {
          pre: this.getTransformationByFolder(folder),
        },
      },
    };
  }

  async generateUploadSignature() {
    const token = Date.now().toString();
    const expire = Math.floor(Date.now() / 1000) + 1800; // 30 minutes instead of 1 hour

    const authParams = imagekit.getAuthenticationParameters(token, expire);
    return {
      signature: authParams.signature,
      expire: authParams.expire,
      token: authParams.token,
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    };
  }

  private getTransformationByFolder(folder: string): string {
    const transformations: Record<string, string> = {
      "vendor-logos": "w-200,h-200,c-maintain_ratio",
      "featured-images": "w-800,q-85",
      "portfolio-images": "w-800,q-80",
      "portfolio-videos": "",
      banners: "w-1200,q-90",
    };

    return transformations[folder] || "w-800,q-80";
  }
}
