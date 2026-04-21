import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function emailNotify(subject: string, html: string) {
  await resend.emails.send({
    from: "Dashboard <dashboard@fieldhouseapparel.com>",
    to: "rob@fieldhouseapparel.com",
    subject,
    html,
  });
}