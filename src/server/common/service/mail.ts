import nodemailer from 'nodemailer';

const smtpTransport = nodemailer.createTransport({
    host: 'smtp.example.com',
    port: 587,
    auth: {
      user: 'username',
      pass: 'password'
    }
});

const sendEmail = async (emailAddress: string, subject: string, textMessage: string, htmlMessage?: string ) => {
    try {
      const info = await smtpTransport.sendMail({
        from: 'sender@example.com',
        to: emailAddress,
        subject: subject,
        text: textMessage,
        html: htmlMessage
      });
      console.log('Message sent:', info.messageId);
    } catch (error) {
      console.error('Error sending email:', error);
    }
  };

  export default sendEmail;