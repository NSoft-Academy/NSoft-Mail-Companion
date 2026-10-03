require ["fileinto", "mailbox"];
if anyof(header :is "X-Spam-Flag" "YES", header :is "X-Spam" "Yes") {
  fileinto :create "Junk";
  stop;
}
