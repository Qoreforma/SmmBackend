import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFAQ extends Document {
  faqCategoryId: Types.ObjectId;
  question: string;
  isActive: boolean;
  slug: string;
  answer: string;
  createdAt: Date;
  updatedAt: Date;
  legacyFaqId?: string;
}

const faqSchema = new Schema<IFAQ>(
  {
    faqCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "FaqCategory",
      required: true,
      index: true,
    },
    question: {
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
    answer: {
      type: String,
      required: true,
    },
    legacyFaqId: { type: String, index: true, sparse: true },
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

faqSchema.pre("save", async function (next) {
  // only generate when slug is missing (covers new docs and ones explicitly cleared)
  if (this.slug) return next();

  const baseSlug = slugify(this.question);
  let candidate = baseSlug;
  let counter = 1;

  // FAQ here refers to the model — defined below, so use this.constructor
  const Model = this.constructor as mongoose.Model<IFAQ>;

  while (
    await Model.exists({
      slug: candidate,
      _id: { $ne: this._id }, // exclude self in case of re-save
    })
  ) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  this.slug = candidate;
  next();
});

export const FAQ = mongoose.model<IFAQ>("FAQ", faqSchema);