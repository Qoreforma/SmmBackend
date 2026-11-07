import mongoose, { Schema, Document } from "mongoose";

export interface IFaqCategory extends Document {
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  legacyFaqCategoryId?: string;
}

const faqCategorySchema = new Schema<IFaqCategory>(
  {
    name: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    legacyFaqCategoryId: {
      type: String,
      index: true,
      sparse: true,
    },
  },
  {
    timestamps: true,
  }
);

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // strip non-word chars
    .replace(/[\s_-]+/g, "-") // collapse whitespace/underscores to single dash
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes
}

faqCategorySchema.pre("save", async function (next) {
  if (this.slug) return next();

  const baseSlug = slugify(this.name);
  let candidate = baseSlug;
  let counter = 1;

  const Model = this.constructor as mongoose.Model<IFaqCategory>;

  while (
    await Model.exists({
      slug: candidate,
      _id: { $ne: this._id },
    })
  ) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  this.slug = candidate;
  next();
});

export const FaqCategory = mongoose.model<IFaqCategory>(
  "FaqCategory",
  faqCategorySchema
);