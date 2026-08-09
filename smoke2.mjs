const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const tl = await fetch("https://www.talent.com/jobs?k=software+engineer&l=United+States", { headers: { "user-agent": UA, accept: "text/html" } });
const tlBody = await tl.text();
console.log("talent status:", tl.status, "size:", tlBody.length, "cards:", (tlBody.match(/JobCard_card/g) ?? []).length);
const hj = await fetch("https://hasjob.co/?q=software+engineer", { headers: { "user-agent": UA, accept: "text/html" } });
const hjBody = await hj.text();
console.log("hasjob status:", hj.status, "size:", hjBody.length, "stickies:", (hjBody.match(/class="stickie"/g) ?? []).length);
