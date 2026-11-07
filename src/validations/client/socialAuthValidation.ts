import Joi from "joi";

export const googleSignInSchema = Joi.object({
  googleIdToken: Joi.string().required().messages({
    "string.empty": "Google ID token is required",
    "any.required": "Google ID token is required",
  }),
  fcmToken: Joi.string().optional(),
});

export const appleSignInSchema = Joi.object({
  appleIdentityToken: Joi.string().required().messages({
    "string.empty": "Apple identity token is required",
    "any.required": "Apple identity token is required",
  }),
  appleRefreshToken: Joi.string().optional(),
  appleAuthCode: Joi.string().optional(),
  fcmToken: Joi.string().optional(),
  profile: Joi.object({
    firstname: Joi.string().optional(),
    lastname: Joi.string().optional(),
  })
});

export const linkAccountSchema = Joi.object({
  googleIdToken: Joi.string().optional(),
  appleIdentityToken: Joi.string().optional(),
})
  .or("googleIdToken", "appleIdentityToken")
  .messages({
    "object.missing": "Either googleIdToken or appleIdentityToken is required",
  });
