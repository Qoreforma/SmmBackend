import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';

export const requestLogger = morgan('combined', {
  skip: (req: Request, res: Response) => {
    return res.statusCode < 400;
  },
});

export const devLogger = morgan('dev');
