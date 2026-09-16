import mongoose from "mongoose";

export const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not defined in environment variables");
  }
  try {
    const defaultPoolSize = 10;
    let maxPoolSize = process.env.MONGO_POOL_SIZE
      ? parseInt(process.env.MONGO_POOL_SIZE)
      : defaultPoolSize;
    let minPoolSize = process.env.MONGO_MIN_POOL_SIZE
      ? parseInt(process.env.MONGO_MIN_POOL_SIZE)
      : defaultPoolSize;

    let warningMessage: string | undefined;
    switch (true) { // cheap trick, lol
      case Number.isNaN(maxPoolSize) || Number.isNaN(minPoolSize):
        warningMessage =
          "Invalid pool size values in environment variables, using default values of 10";
        break;
      case maxPoolSize < 1 || minPoolSize < 1:
        warningMessage =
          "Pool size values must be greater than 0, using default values of 10";
        break;
      case minPoolSize > maxPoolSize:
        warningMessage =
          "Minimum pool size cannot be greater than maximum pool size, using default values of 10";
        break;
    }

    if (warningMessage) {
      console.warn(warningMessage);
      maxPoolSize = defaultPoolSize;
      minPoolSize = defaultPoolSize;
    }
    await mongoose.connect(process.env.MONGO_URI, { maxPoolSize, minPoolSize });
    console.log("MongoDB connected");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
};



export default {connectDB}; // room for other stuff later