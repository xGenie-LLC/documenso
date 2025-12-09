import crypto from 'crypto';
import { DateTime } from 'luxon';

import { prisma } from '@documenso/prisma';

import { USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER } from '../../constants/email';
import { ONE_HOUR } from '../../constants/time';
import { sendConfirmationEmail } from '../auth/send-confirmation-email';
import { getMostRecentEmailVerificationToken } from './get-most-recent-email-verification-token';

type SendConfirmationTokenOptions = { email: string; force?: boolean };

export const sendConfirmationToken = async ({
  email,
  force = false,
}: SendConfirmationTokenOptions) => {
  const token = crypto.randomBytes(20).toString('hex');

  const user = await prisma.user.findFirst({
    where: {
      email: email,
    },
  });

  if (!user) {
    // Don't throw error - just return silently to prevent job retries
    // and avoid revealing whether email exists in system
    console.log(`[sendConfirmationToken] User not found for email: ${email}`);
    return { success: false, reason: 'user_not_found' };
  }

  if (user.emailVerified) {
    // Don't throw error - email is already verified, just return
    return { success: false, reason: 'email_already_verified' };
  }

  const mostRecentToken = await getMostRecentEmailVerificationToken({ userId: user.id });

  // If we've sent a token in the last 5 minutes, don't send another one
  if (
    !force &&
    mostRecentToken?.createdAt &&
    DateTime.fromJSDate(mostRecentToken.createdAt).diffNow('minutes').minutes > -5
  ) {
    // return;
  }

  const createdToken = await prisma.verificationToken.create({
    data: {
      identifier: USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER,
      token: token,
      expires: new Date(Date.now() + ONE_HOUR),
      user: {
        connect: {
          id: user.id,
        },
      },
    },
  });

  if (!createdToken) {
    throw new Error(`Failed to create the verification token`);
  }

  try {
    await sendConfirmationEmail({ userId: user.id });

    return { success: true };
  } catch (err) {
    console.log(err);
    throw new Error(`Failed to send the confirmation email`);
  }
};
